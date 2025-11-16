import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, Subject } from 'rxjs';
import { catchError, retry, tap } from 'rxjs/operators';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { ApiResponse, Detection, RTSPConnectionRequest, StartDetectionRequest } from '../models/detection';

export interface DetectionResult {
  frame: string;
  detections: Detection[];
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class PythonApiService {
  private http = inject(HttpClient);
  
  // API Configuration
  private readonly API_URL = 'https://safezone-ai-h9lt.onrender.com';
  private readonly WS_URL = 'wss://safezone-ai-h9lt.onrender.com/ws';

  // WebSocket
  private socket$!: WebSocketSubject<DetectionResult>;
  private detectionResults$ = new Subject<DetectionResult>();
  
  // HTTP Options
  private httpOptions = {
    headers: new HttpHeaders({
      'Content-Type': 'application/json'
    })
  };

  constructor() {
    console.log('PythonApiService initialized');
  }

  startPreview(request: { source: 'webcam' | 'video' | 'rtsp', rtsp_url?: string }): Observable<ApiResponse> {
    const payload = {
      source: request.source,
      region: { x: 0, y: 0, width: 1, height: 1 }, // Dummy region for preview
      rtsp_url: request.rtsp_url
    };
    
    return this.http.post<ApiResponse>(
      `${this.API_URL}/start-preview`,
      payload,
      this.httpOptions
    ).pipe(
      tap(response => console.log('Preview started:', response)),
      catchError(this.handleError)
    );
  }

  /**
   * Health check endpoint
   */
  healthCheck(): Observable<any> {
    return this.http.get(`${this.API_URL}/`)
      .pipe(
        tap(response => console.log('Health check response:', response)),
        catchError(this.handleError)
      );
  }

  /**
   * Connect to RTSP stream
   */
  connectRTSP(rtspUrl: string): Observable<ApiResponse> {
    const payload: RTSPConnectionRequest = { url: rtspUrl };
    
    return this.http.post<ApiResponse>(
      `${this.API_URL}/connect-rtsp`,
      payload,
      this.httpOptions
    ).pipe(
      tap(response => console.log('RTSP connection response:', response)),
      retry(1),
      catchError(this.handleError)
    );
  }

  /**
   * Start detection
   */
  startDetection(request: StartDetectionRequest): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(
      `${this.API_URL}/start-detection`,
      request,
      this.httpOptions
    ).pipe(
      tap(response => console.log('Start detection response:', response)),
      catchError(this.handleError)
    );
  }

  /**
   * Stop detection
   */
  stopDetection(): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(
      `${this.API_URL}/stop-detection`,
      {},
      this.httpOptions
    ).pipe(
      tap(response => console.log('Stop detection response:', response)),
      catchError(this.handleError)
    );
  }

  /**
   * Connect to WebSocket for real-time detection results
   */
  connectWebSocket(): Observable<DetectionResult> {
    // Always create new WebSocket connection
    console.log('Creating new WebSocket connection...');
    
    this.socket$ = webSocket<DetectionResult>({
      url: this.WS_URL,
      deserializer: (e) => JSON.parse(e.data),
      openObserver: {
        next: () => {
          console.log('✅ WebSocket connected successfully');
        }
      },
      closeObserver: {
        next: () => { 
          console.log('WebSocket connection closed');
        }
      }
    });

    // Subscribe to WebSocket messages
    this.socket$.subscribe({
      next: (data: DetectionResult) => {
        console.log('📦 WebSocket data received');
        this.detectionResults$.next(data);
      },
      error: (error) => {
        console.error('❌ WebSocket error:', error);
        this.handleWebSocketError(error);
      },
      complete: () => {
        console.log('WebSocket connection completed');
      }
    });

    return this.detectionResults$.asObservable();
  }

  /**
   * Disconnect WebSocket
   */
  disconnectWebSocket(): void {
    if (this.socket$ && !this.socket$.closed) {
      console.log('Disconnecting WebSocket...');
      this.socket$.complete();
      this.socket$ = null as any; // Clear reference
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isWebSocketConnected(): boolean {
    return this.socket$ && !this.socket$.closed;
  }

  /**
   * Send message through WebSocket
   */
  sendWebSocketMessage(message: any): void {
    if (this.socket$ && !this.socket$.closed) {
      this.socket$.next(message);
    } else {
      console.error('WebSocket is not connected');
    }
  }

  /**
   * Handle HTTP errors
   */
  private handleError(error: HttpErrorResponse): Observable<never> {
    let errorMessage = 'An unknown error occurred';

    if (error.error instanceof ErrorEvent) {
      // Client-side or network error
      errorMessage = `Client Error: ${error.error.message}`;
    } else {
      // Backend returned an unsuccessful response code
      errorMessage = `Server Error: ${error.status} - ${error.message}`;
      
      if (error.error && error.error.detail) {
        errorMessage = `Server Error: ${error.error.detail}`;
      }
    }

    console.error('HTTP Error:', errorMessage);
    return throwError(() => new Error(errorMessage));
  }

  /**
   * Handle WebSocket errors
   */
  private handleWebSocketError(error: any): void {
    console.error('WebSocket Error:', error);
    
    // Attempt to reconnect after a delay
    setTimeout(() => {
      console.log('Attempting to reconnect WebSocket...');
      this.connectWebSocket();
    }, 5000);
  }

  /**
   * Cleanup on service destroy
   */
  ngOnDestroy(): void {
    this.disconnectWebSocket();
    this.detectionResults$.complete();
  }
}
