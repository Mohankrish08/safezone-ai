export interface DetectionResult {
  frame: string;
  detections: Array<{
    class: string;
    confidence: number;
    bbox: number[];
  }>;
  timestamp: number;
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StartDetectionRequest {
  source: 'webcam' | 'video' | 'rtsp';
  region: Region;
  rtsp_url?: string;
}

export interface RTSPConnectionRequest {
  url: string;
}

export interface Detection {
  class_name: string;
  confidence: number;
  bbox: number[]; // [x, y, w, h]
}

export interface ApiResponse {
  status: string;
  message: string;
}