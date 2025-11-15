from pydantic import BaseModel
from typing import List, Optional, Literal

class Region(BaseModel):
    x: float  # Accept float
    y: float  # Accept float
    width: float  # Accept float
    height: float  # Accept float

class StartDetectionRequest(BaseModel):
    source: Literal['webcam', 'video', 'rtsp']
    region: Region
    rtsp_url: Optional[str] = None

class RTSPConnectionRequest(BaseModel):
    url: str

class Detection(BaseModel):
    class_name: str
    confidence: float
    bbox: List[int]  # [x, y, w, h]

class DetectionResult(BaseModel):
    frame: str  # base64 encoded image
    detections: List[Detection]
    timestamp: int
