import asyncio
import base64
import cv2
import time
from app import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Optional, List
from ultralytics import YOLO
from twilio.rest import Client
import numpy as np
import os

from models import StartDetectionRequest, RTSPConnectionRequest, DetectionResult, Detection, Region
from logger_config import logger

# Initialize FastAPI app
app = FastAPI(title="SafeZone AI API", version="1.0.0")

account_sid = 'AC023e4c1f37a5a0811de004384d1ed575'
auth_token = 'a81a385910aea745fa9b3848b2c1be64'

twilio_phone_number = '+18149626276'
recipient_phone_number = '+919789524300'

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables
model: Optional[YOLO] = None
active_connections: List[WebSocket] = []
detection_state: Dict = {
    'is_running': False,
    'cap': None,
    'region': None,
    'source': None,
    'rtsp_url': None
}

# Model path - Update this to your actual model location
MODEL_PATH = "../models/best.pt"

def load_model():
    """Load YOLO model on startup"""
    global model
    try:
        if not os.path.exists(MODEL_PATH):
            logger.error(f"Model file not found: {MODEL_PATH}")
            logger.error(f"Current directory: {os.getcwd()}")
            logger.warning("Attempting to use YOLOv8n pretrained model instead...")
            
            model = YOLO('yolov8n.pt')  # This will auto-download if not present
            logger.info("YOLOv8n pretrained model loaded successfully")
        else:
            logger.info(f"Loading YOLO model from {MODEL_PATH}")
            model = YOLO(MODEL_PATH)
            logger.info("Custom YOLO model loaded successfully")
        
        logger.info(f"Model type: {type(model)}")
        logger.info(f"Model classes: {model.names}")
        
    except Exception as e:
        logger.error(f"Failed to load YOLO model: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        raise

def send_twilio_message(people_count):
    message_body = f'There are {people_count} people detected in the area'
    client = Client(account_sid, auth_token)
    message = client.messages.create(
        body=message_body,
        from_=twilio_phone_number,
        to=recipient_phone_number
    )
    print('Message SID:', message.sid)

@app.on_event("startup")
async def startup_event():
    """Initialize application on startup"""
    logger.info("=" * 60)
    logger.info("Starting SafeZone AI API...")
    logger.info("=" * 60)
    
    # Cleanup any existing camera sessions
    logger.info("Checking for existing camera sessions...")
    detection_state['is_running'] = False
    if detection_state['cap'] is not None:
        detection_state['cap'].release()
        detection_state['cap'] = None
        logger.info("Cleaned up existing camera session")
    
    load_model()
    
    if model is None:
        logger.error("CRITICAL: Model failed to load!")
        raise RuntimeError("YOLO model not loaded")
    
    logger.info("SafeZone AI API started successfully")
    logger.info("=" * 60)


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down SafeZone AI API...")
    
    if detection_state['cap'] is not None:
        detection_state['cap'].release()
        detection_state['cap'] = None
        logger.info("Released camera on shutdown")
    
    logger.info("SafeZone AI API shutdown complete")

@app.get("/")
async def root():
    logger.info("Health check endpoint called")
    return {
        "status": "running",
        "service": "SafeZone AI API",
        "version": "1.0.0",
        "model_loaded": model is not None
    }

@app.get("/model-status")
async def model_status():
    return {
        "model_loaded": model is not None,
        "model_type": str(type(model)) if model else "None",
        "model_path": MODEL_PATH,
        "model_classes": model.names if model else None
    }

@app.post("/connect-rtsp")
async def connect_rtsp(request: RTSPConnectionRequest):
    try:
        logger.info(f"Attempting to connect to RTSP stream: {request.url}")
        
        cap = cv2.VideoCapture(request.url)
        if not cap.isOpened():
            logger.error(f"Failed to open RTSP stream: {request.url}")
            raise HTTPException(status_code=400, detail="Failed to connect to RTSP stream")
        
        cap.release()
        logger.info(f"Successfully connected to RTSP stream: {request.url}")
        
        return {
            "status": "success",
            "message": "RTSP stream connected successfully"
        }
    except Exception as e:
        logger.error(f"Error connecting to RTSP: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    
@app.post("/start-preview")
async def start_preview(request: StartDetectionRequest):
    try:
        logger.info(f"Starting preview - Source: {request.source}")
        
        if detection_state['is_running']:
            logger.warning("Already running, stopping previous session")
            await stop_detection()
            await asyncio.sleep(1)
        
        detection_state['source'] = request.source
        detection_state['rtsp_url'] = request.rtsp_url
        detection_state['region'] = None
        
        if request.source == 'rtsp':
            logger.info(f"Opening RTSP stream: {request.rtsp_url}")
            
            import os
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;udp"
            
            detection_state['cap'] = cv2.VideoCapture(request.rtsp_url, cv2.CAP_FFMPEG)
            
            detection_state['cap'].set(cv2.CAP_PROP_BUFFERSIZE, 1)
            
            await asyncio.sleep(2)
            
            if not detection_state['cap'].isOpened():
                logger.error("RTSP stream failed to open")
                raise HTTPException(status_code=400, detail="Failed to connect to RTSP stream")
            
            ret, frame = detection_state['cap'].read()
            if not ret or frame is None:
                logger.error("Cannot read frames from RTSP")
                detection_state['cap'].release()
                detection_state['cap'] = None
                raise HTTPException(status_code=400, detail="RTSP connected but cannot read frames")
            
            logger.info(f"RTSP preview ready - Frame size: {frame.shape}")
        
        detection_state['is_running'] = True
        logger.info("Preview started successfully")
        
        return {
            "status": "success",
            "message": "Preview started successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting preview: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        
        if detection_state['cap'] is not None:
            detection_state['cap'].release()
            detection_state['cap'] = None
        
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/start-detection")
async def start_detection(request: StartDetectionRequest):
    try:
        logger.info(f"Starting detection - Source: {request.source}, Region: {request.region.dict()}")
        
        if model is None:
            logger.error("Model is not loaded!")
            raise HTTPException(status_code=500, detail="YOLO model is not loaded")
        
        if detection_state['is_running']:
            logger.warning("Already running, stopping previous session")
            await stop_detection()
            await asyncio.sleep(1)
        
        # Store configuration
        detection_state['region'] = request.region
        detection_state['source'] = request.source
        detection_state['rtsp_url'] = request.rtsp_url
        
        # Open video source
        if request.source == 'webcam':
            logger.info("Opening webcam for detection")
            
            backends = [
                (cv2.CAP_DSHOW, "DirectShow"),
                (cv2.CAP_MSMF, "MSMF"),
                (cv2.CAP_ANY, "Any Available")
            ]
            
            cap = None
            for backend, name in backends:
                logger.info(f"Trying camera backend: {name}")
                temp_cap = cv2.VideoCapture(0, backend)
                
                if temp_cap.isOpened():
                    ret, test_frame = temp_cap.read()
                    if ret:
                        logger.info(f"Webcam opened with {name}")
                        cap = temp_cap
                        detection_state['cap'] = cap
                        break
                    else:
                        temp_cap.release()
            
            if cap is None:
                raise HTTPException(status_code=400, detail="Failed to open webcam")
                
        elif request.source == 'rtsp':
            logger.info(f"Opening RTSP stream for detection: {request.rtsp_url}")
            
            # Set RTSP options
            import os
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;udp"
            
            detection_state['cap'] = cv2.VideoCapture(request.rtsp_url, cv2.CAP_FFMPEG)
            detection_state['cap'].set(cv2.CAP_PROP_BUFFERSIZE, 1)
            
            await asyncio.sleep(2)
            
            if not detection_state['cap'].isOpened():
                raise HTTPException(status_code=400, detail="Failed to open RTSP stream")
            
            # Test read
            ret, frame = detection_state['cap'].read()
            if not ret:
                detection_state['cap'].release()
                detection_state['cap'] = None
                raise HTTPException(status_code=400, detail="RTSP stream cannot read frames")
            
            logger.info(f"RTSP detection ready - Frame: {frame.shape}")
        else:
            raise HTTPException(status_code=400, detail="Video file source not yet implemented")
        
        detection_state['is_running'] = True
        logger.info("Detection started successfully")
        
        return {
            "status": "success",
            "message": "Detection started successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting detection: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/stop-detection")
async def stop_detection():
    try:
        logger.info("Stopping detection")
        
        detection_state['is_running'] = False
        
        if detection_state['cap'] is not None:
            logger.info("Releasing video capture...")
            detection_state['cap'].release()
            detection_state['cap'] = None
            
            await asyncio.sleep(0.5)
            
            logger.info("Video capture released")
        
        detection_state['region'] = None
        detection_state['source'] = None
        detection_state['rtsp_url'] = None
        
        for ws in active_connections:
            try:
                await ws.close()
            except:
                pass
        active_connections.clear()
        
        logger.info("Detection stopped successfully")
        
        return {
            "status": "success",
            "message": "Detection stopped successfully"
        }
    except Exception as e:
        logger.error(f"Error stopping detection: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

def process_frame(frame: np.ndarray, region: Region) -> tuple:
    global model
    
    try:
        # Check if model is loaded
        if model is None:
            logger.error("Model is None in process_frame!")
            return frame, []
        
        x1 = int(region.x)
        y1 = int(region.y)
        x2 = int(region.x + region.width)
        y2 = int(region.y + region.height)
        
        h, w = frame.shape[:2]
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(w, x2)
        y2 = min(h, y2)
        
        # Extract ROI
        roi = frame[y1:y2, x1:x2]
        
        if roi.size == 0:
            logger.warning("Invalid ROI size")
            return frame, []
        
        results = model(roi, verbose=False)[0]
        class_names = results.names
        
        detections = []
        persons = 0
        display_frame = frame.copy()
        
        cv2.rectangle(display_frame, (x1, y1), (x2, y2), (255, 0, 0), 2)
        cv2.putText(display_frame, "Detection Zone", (x1, y1 - 10),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 0), 2)
        
        for box in results.boxes.data.tolist():
            bx1, by1, bx2, by2, score, class_id = box
            
            abs_x1 = int(bx1) + x1
            abs_y1 = int(by1) + y1
            abs_x2 = int(bx2) + x1
            abs_y2 = int(by2) + y1
            
            class_name = class_names[int(class_id)]
            
            is_helmet = 'helmet' in class_name.lower() and 'no' not in class_name.lower()
            color = (0, 255, 0) if is_helmet else (0, 0, 255)
            
            cv2.rectangle(display_frame, (abs_x1, abs_y1), (abs_x2, abs_y2), color, 3)
            
            label = f"{class_name}: {score:.2f}"
            (label_w, label_h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
            cv2.rectangle(display_frame, 
                         (abs_x1, abs_y1 - label_h - 10), 
                         (abs_x1 + label_w, abs_y1), 
                         color, -1)
            
            cv2.putText(display_frame, label, (abs_x1, abs_y1 - 5),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            
            if class_name.lower() == 'person' and class_name.lower() == 'no helmet':
                persons += 1
            detections.append(Detection(
                class_name=class_name,
                confidence=float(score),
                bbox=[abs_x1, abs_y1, abs_x2 - abs_x1, abs_y2 - abs_y1]
            ))
            
            if persons >= 1:
                send_twilio_message(persons)
            
            logger.debug(f"Detected: {class_name} with confidence {score:.2f}")
        
        return display_frame, detections
    
    except Exception as e:
        logger.error(f"Error processing frame: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return frame, []

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    logger.info(f"WebSocket client connected. Active connections: {len(active_connections)}")
    
    retry_count = 0
    max_retries = 30  # Increased for RTSP
    frame_count = 0
    last_frame_time = time.time()
    
    try:
        while True:
            if not detection_state['is_running'] or detection_state['cap'] is None:
                await asyncio.sleep(0.1)
                continue
            
            ret, frame = detection_state['cap'].read()
            
            if not ret:
                retry_count += 1
                logger.warning(f"Failed to read frame (attempt {retry_count}/{max_retries})")
                
                if detection_state['source'] == 'rtsp' and retry_count < max_retries:
                    logger.info("Attempting to reconnect RTSP stream...")
                    detection_state['cap'].release()
                    await asyncio.sleep(1)
                    
                    detection_state['cap'] = cv2.VideoCapture(detection_state['rtsp_url'])
                    await asyncio.sleep(1)
                    
                    if detection_state['cap'].isOpened():
                        logger.info("RTSP reconnected successfully")
                        retry_count = 0
                        continue
                
                if retry_count >= max_retries:
                    logger.error("Max retries reached. Stopping stream.")
                    error_message = {
                        "error": "Stream disconnected",
                        "message": "Failed to read frames from video source"
                    }
                    await websocket.send_json(error_message)
                    break
                
                await asyncio.sleep(0.5)
                continue
            
            retry_count = 0
            frame_count += 1
            current_time = time.time()
            
            if detection_state['region']:
                # DETECTION MODE - Process with YOLO
                region = detection_state['region']
                processed_frame, detections = process_frame(frame, region)
            else:
                # PREVIEW MODE - Just send raw frame
                processed_frame = frame
                detections = []
            
            # Encode frame
            encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 85]
            _, buffer = cv2.imencode('.jpg', processed_frame, encode_param)
            frame_base64 = base64.b64encode(buffer).decode('utf-8')
            
            result = DetectionResult(
                frame=frame_base64,
                detections=detections,
                timestamp=int(time.time() * 1000)
            )
            
            try:
                await websocket.send_json(result.dict())
            except Exception as e:
                logger.error(f"Error sending frame: {str(e)}")
                break
            
            if frame_count % 30 == 0:
                fps = 30 / (current_time - last_frame_time) if last_frame_time else 0
                logger.info(f"Frame {frame_count} - FPS: {fps:.1f} - Detections: {len(detections)}")
                last_frame_time = current_time
            
            await asyncio.sleep(0.033)  # ~30 FPS
    
    except WebSocketDisconnect:
        active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Active connections: {len(active_connections)}")
    
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        if websocket in active_connections:
            active_connections.remove(websocket)

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting Uvicorn server...")
    
    # Initialize model before starting server
    load_model()
    
    uvicorn.run(app, host="0.0.0.0", port=5000, log_level="info")
