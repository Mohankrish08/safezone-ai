import { Component, ElementRef, Inject, ViewChild, OnInit, AfterViewInit, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PythonApiService, DetectionResult } from '../services/python-api.service';

@Component({
  selector: 'app-interface',
  imports: [CommonModule, FormsModule],
  templateUrl: './interface.component.html',
  styleUrl: './interface.component.css'
})
export class InterfaceComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('videoCanvas', { static: false }) videoCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('videoElement', { static: false }) videoElement!: ElementRef<HTMLVideoElement>;

  private ctx!: CanvasRenderingContext2D;
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  isBrowser: boolean;
  private animationFrameId?: number;
  private localStream: MediaStream | null = null;

  selectedRegion: { x: number; y: number; width: number; height: number } | null = null;
  isDetecting = false;
  selectedSource: 'webcam' | 'video' | 'rtsp' = 'webcam';
  videoFile: File | null = null;
  rtspUrl: string = '';
  detectionResults: DetectionResult[] = [];
  currentDetections: any[] = [];
  isVideoReady = false;

  constructor(
    private apiService: PythonApiService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit(): void {
    if (!this.isBrowser) return;
    
    // Stop any existing camera on page load
    this.stopLocalCamera();
    this.cleanupBackendResources();
    
    // Add event listeners for page unload
    window.addEventListener('beforeunload', this.handlePageUnload.bind(this));
    
    this.apiService.healthCheck().subscribe({
      next: (response) => console.log('API is healthy:', response),
      error: (error) => console.error('API health check failed:', error)
    });
  }

  private handlePageUnload = (event: BeforeUnloadEvent): void => {
    console.log('Page unloading, cleaning up resources...');
    
    // Stop local camera
    this.stopLocalCamera();
    
    // Stop backend detection
    this.cleanupBackendResources();
  };

  private cleanupBackendResources(): void {
    if (!this.isBrowser) return;
    
    // Send synchronous request to stop detection
    navigator.sendBeacon(`${this.apiService['API_URL']}/stop-detection`, 
      JSON.stringify({}));
    
    console.log('Backend resources cleanup requested');
  }

  stopLocalCamera(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        track.stop();
        console.log('Stopped camera track:', track.label);
      });
      this.localStream = null;
    }
    
    if (this.videoElement && this.videoElement.nativeElement.srcObject) {
      this.videoElement.nativeElement.srcObject = null;
    }
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
    
    this.isVideoReady = false;
  }

  ngAfterViewInit(): void {
    if (this.isBrowser && this.videoCanvas) {
      this.ctx = this.videoCanvas.nativeElement.getContext('2d')!;
      this.setupCanvas();
    }
  }

  setupCanvas(): void {
    if (!this.isBrowser) return;
    
    this.videoCanvas.nativeElement.width = 800;
    this.videoCanvas.nativeElement.height = 600;
    
    this.ctx.fillStyle = '#1a1a1a';
    this.ctx.fillRect(0, 0, 800, 600);
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = '24px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('📹 Click "Webcam" to start', 400, 280);
    this.ctx.font = '16px Arial';
    this.ctx.fillStyle = '#999999';
    this.ctx.fillText('Then draw a region for detection', 400, 320);
  }

  onMouseDown(event: MouseEvent): void {
    if (!this.isBrowser || this.isDetecting || !this.isVideoReady) return;
    
    const rect = this.videoCanvas.nativeElement.getBoundingClientRect();
    this.startX = event.clientX - rect.left;
    this.startY = event.clientY - rect.top;
    
    // Scale to canvas coordinates
    const scaleX = this.videoCanvas.nativeElement.width / rect.width;
    const scaleY = this.videoCanvas.nativeElement.height / rect.height;
    this.startX *= scaleX;
    this.startY *= scaleY;
    
    this.isDrawing = true;
  }

  onMouseMove(event: MouseEvent): void {
    if (!this.isBrowser || !this.isDrawing || !this.isVideoReady) return;

    const rect = this.videoCanvas.nativeElement.getBoundingClientRect();
    let currentX = event.clientX - rect.left;
    let currentY = event.clientY - rect.top;
    
    // Scale to canvas coordinates
    const scaleX = this.videoCanvas.nativeElement.width / rect.width;
    const scaleY = this.videoCanvas.nativeElement.height / rect.height;
    currentX *= scaleX;
    currentY *= scaleY;

    // Selection rectangle will be drawn in the animation loop
  }

  onMouseUp(event: MouseEvent): void {
    if (!this.isBrowser || !this.isDrawing || !this.isVideoReady) return;

    const rect = this.videoCanvas.nativeElement.getBoundingClientRect();
    let endX = event.clientX - rect.left;
    let endY = event.clientY - rect.top;
    
    // Scale to canvas coordinates
    const scaleX = this.videoCanvas.nativeElement.width / rect.width;
    const scaleY = this.videoCanvas.nativeElement.height / rect.height;
    endX *= scaleX;
    endY *= scaleY;

    const width = Math.abs(endX - this.startX);
    const height = Math.abs(endY - this.startY);
    const x = Math.min(this.startX, endX);
    const y = Math.min(this.startY, endY);

    if (width > 10 && height > 10) {
      this.selectedRegion = { 
        x: Math.round(x), 
        y: Math.round(y), 
        width: Math.round(width), 
        height: Math.round(height) 
      };
      
      console.log('Region selected:', this.selectedRegion);
    }

    this.isDrawing = false;
  }

  clearRegion(): void {
    if (!this.isBrowser) return;
    this.selectedRegion = null;
  }

  async startWebcam(): Promise<void> {
    if (!this.isBrowser) return;
    
    try {
      // Stop any existing stream first
      this.stopLocalCamera();
      
      // Request webcam access
      this.localStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
      
      this.videoElement.nativeElement.srcObject = this.localStream;
      await this.videoElement.nativeElement.play();
      
      this.selectedSource = 'webcam';
      this.isVideoReady = true;
      
      // Start drawing video frames
      this.drawLocalVideoFrame();
      
      console.log('Webcam started successfully');
    } catch (error) {
      console.error('Error accessing webcam:', error);
      alert('Failed to access webcam. Please ensure camera permissions are granted.');
    }
  }

  drawLocalVideoFrame(): void {
    if (!this.isBrowser || !this.isVideoReady || this.isDetecting) {
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = undefined;
      }
      return;
    }
    
    const video = this.videoElement.nativeElement;
    const canvas = this.videoCanvas.nativeElement;
    const ctx = this.ctx;
    
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      // Calculate scaling
      const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const scaledWidth = video.videoWidth * scale;
      const scaledHeight = video.videoHeight * scale;
      const offsetX = (canvas.width - scaledWidth) / 2;
      const offsetY = (canvas.height - scaledHeight) / 2;
      
      // Clear and draw black background
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw video frame
      ctx.drawImage(video, offsetX, offsetY, scaledWidth, scaledHeight);
      
      // Draw selected region
      if (this.selectedRegion) {
        ctx.strokeStyle = '#00FF00';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 5]);
        ctx.strokeRect(
          this.selectedRegion.x,
          this.selectedRegion.y,
          this.selectedRegion.width,
          this.selectedRegion.height
        );
        ctx.setLineDash([]);
        
        // Draw label
        ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
        ctx.fillRect(this.selectedRegion.x, this.selectedRegion.y - 30, 150, 30);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('Detection Zone', this.selectedRegion.x + 5, this.selectedRegion.y - 10);
      }
      
      // Draw current drawing rectangle
      if (this.isDrawing) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = event instanceof MouseEvent ? event.clientX - rect.left : 0;
        const mouseY = event instanceof MouseEvent ? event.clientY - rect.top : 0;
        
        ctx.strokeStyle = '#00FF00';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(this.startX, this.startY, mouseX - this.startX, mouseY - this.startY);
        ctx.setLineDash([]);
      }
      
      // Draw instructions overlay
      if (!this.selectedRegion) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(10, canvas.height - 60, 350, 50);
        ctx.fillStyle = '#00FF00';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('👆 Click and drag to select detection zone', 20, canvas.height - 30);
      }
    }
    
    this.animationFrameId = requestAnimationFrame(() => this.drawLocalVideoFrame());
  }

  // stopLocalCamera(): void {
  //   if (this.localStream) {
  //     this.localStream.getTracks().forEach(track => {
  //       track.stop();
  //       console.log('Stopped camera track:', track.label);
  //     });
  //     this.localStream = null;
  //   }
    
  //   if (this.videoElement && this.videoElement.nativeElement.srcObject) {
  //     this.videoElement.nativeElement.srcObject = null;
  //   }
    
  //   if (this.animationFrameId) {
  //     cancelAnimationFrame(this.animationFrameId);
  //     this.animationFrameId = undefined;
  //   }
    
  //   this.isVideoReady = false;
  // }

  onVideoFileSelected(event: Event): void {
      if (!this.isBrowser) return;
      
      const input = event.target as HTMLInputElement;
      if (input.files && input.files[0]) {
        this.videoFile = input.files[0];
        this.selectedSource = 'video';
        alert('Video file selected. This feature is coming soon!');
      }
    }

    async connectRTSP(): Promise<void> {
    if (!this.isBrowser || !this.rtspUrl) {
      alert('Please enter RTSP URL');
      return;
    }

    try {
      console.log('Connecting to RTSP:', this.rtspUrl);
      
      // Stop any existing streams
      this.stopLocalCamera();
      
      // Show connecting state
      this.ctx.fillStyle = '#1a1a1a';
      this.ctx.fillRect(0, 0, 800, 600);
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.font = '20px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('🌐 Connecting to RTSP stream...', 400, 280);
      this.ctx.font = '14px Arial';
      this.ctx.fillStyle = '#999999';
      this.ctx.fillText(this.rtspUrl, 400, 320);
      
      // Start RTSP preview mode
      await this.apiService.startPreview({
        source: 'rtsp',
        rtsp_url: this.rtspUrl
      }).toPromise();
      
      this.selectedSource = 'rtsp';
      this.isVideoReady = true;
      
      // Connect to WebSocket to receive frames
      this.connectToRTSPPreview();
      
      console.log('RTSP preview started - draw region to begin detection');
      
    } catch (error: any) {
      console.error('RTSP connection failed:', error);
      alert('Failed to connect to RTSP: ' + error.message);
      this.setupCanvas();
    }
  }

  connectToRTSPPreview(): void {
    if (!this.isBrowser) return;

    console.log('Connecting to WebSocket for RTSP preview...');

    this.apiService.connectWebSocket().subscribe({
      next: (data: DetectionResult) => {
        // Only draw if NOT in detection mode
        if (!this.isDetecting) {
          this.drawRTSPPreviewFrame(data);
        }
      },
      error: (error) => {
        console.error('WebSocket error:', error);
        alert('Lost connection to RTSP stream');
        this.setupCanvas();
      }
    });
  }

  drawRTSPPreviewFrame(result: DetectionResult): void {
    if (!this.isBrowser || !result.frame) return;
    
    const canvas = this.videoCanvas.nativeElement;
    const ctx = this.ctx;
    
    const img = new Image();
    
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const scaledWidth = img.width * scale;
      const scaledHeight = img.height * scale;
      const offsetX = (canvas.width - scaledWidth) / 2;
      const offsetY = (canvas.height - scaledHeight) / 2;
      
      // Draw black background
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw RTSP frame
      ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);
      
      // Draw selected region if exists
      if (this.selectedRegion) {
        ctx.strokeStyle = '#00FF00';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 5]);
        ctx.strokeRect(
          this.selectedRegion.x,
          this.selectedRegion.y,
          this.selectedRegion.width,
          this.selectedRegion.height
        );
        ctx.setLineDash([]);
        
        // Draw label
        ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
        ctx.fillRect(this.selectedRegion.x, this.selectedRegion.y - 30, 150, 30);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('Detection Zone', this.selectedRegion.x + 5, this.selectedRegion.y - 10);
      }
      
      // Draw instructions if no region selected
      if (!this.selectedRegion && !this.isDetecting) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(10, canvas.height - 60, 400, 50);
        ctx.fillStyle = '#00FF00';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('👆 Click and drag to select detection zone', 20, canvas.height - 30);
      }
      
      // Draw RTSP indicator
      ctx.fillStyle = 'rgba(0, 100, 0, 0.9)';
      ctx.fillRect(10, 10, 200, 40);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'left';
      ctx.fillText('🌐 RTSP PREVIEW', 20, 35);
    };
    
    img.onerror = () => {
      console.error('Failed to load RTSP frame');
    };
    
    img.src = 'data:image/jpeg;base64,' + result.frame;
  }

  startDetection(): void {
    if (!this.isBrowser || !this.selectedRegion) {
      alert('Please select a region first');
      return;
    }

    console.log('Starting detection with region:', this.selectedRegion);
    
    this.isDetecting = true;
    this.currentDetections = [];
    
    this.apiService.disconnectWebSocket();
    if (this.selectedSource === 'webcam') {
      this.stopLocalCamera();
    }

    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, 800, 600);
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = '20px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Starting detection...', 400, 300);

    setTimeout(() => {
      // Use object destructuring to ensure type safety
      const { x, y, width, height } = this.selectedRegion!;
      
      this.apiService.startDetection({
        source: this.selectedSource,
        region: { x, y, width, height },
        rtsp_url: this.selectedSource === 'rtsp' ? this.rtspUrl : undefined
      }).subscribe({
        next: (response) => {
          console.log('Detection API call successful:', response);
          setTimeout(() => {
            console.log('Now connecting WebSocket...');
            this.connectToWebSocket();
          }, 1000);
        },
        error: (error) => {
          console.error('Failed to start detection:', error);
          this.isDetecting = false;
          alert('Failed to start detection: ' + error.message);
          this.setupCanvas();
        }
      });
    }, 1000);
  }



  stopDetection(): void {
    if (!this.isBrowser) return;
    
    this.isDetecting = false;
    this.currentDetections = [];

    this.apiService.stopDetection().subscribe({
      next: (response) => {
        console.log('Detection stopped:', response);
        
        // Restart local webcam preview
        if (this.selectedSource === 'webcam') {
          this.startWebcam();
        }
      },
      error: (error) => {
        console.error('Failed to stop detection:', error);
      }
    });

    this.apiService.disconnectWebSocket();
  }

  connectToWebSocket(): void {
    if (!this.isBrowser) return;

    console.log('Connecting to WebSocket for detection results...');

    this.apiService.connectWebSocket().subscribe({
      next: (data: DetectionResult) => {
        console.log('✅ Frame received:', {
          timestamp: data.timestamp,
          detections: data.detections.length,
          frameLength: data.frame?.length || 0,
          hasFrame: !!data.frame
        });
        
        // Store detections
        this.currentDetections = data.detections;
        this.detectionResults.unshift(data);
        if (this.detectionResults.length > 10) {
          this.detectionResults.pop();
        }
        
        // Draw detection frame
        this.drawDetectionFrame(data);
      },
      error: (error) => {
        console.error('❌ WebSocket error:', error);
        
        // Show error on canvas
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, 800, 600);
        this.ctx.fillStyle = '#FF0000';
        this.ctx.font = '20px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Connection Lost', 400, 300);
      },
      complete: () => {
        console.log('WebSocket stream completed');
      }
    });
  }

  drawDetectionFrame(result: DetectionResult): void {
    if (!this.isBrowser || !result.frame) return;
    
    const canvas = this.videoCanvas.nativeElement;
    const ctx = this.ctx;
    
    const img = new Image();
    
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const scaledWidth = img.width * scale;
      const scaledHeight = img.height * scale;
      const offsetX = (canvas.width - scaledWidth) / 2;
      const offsetY = (canvas.height - scaledHeight) / 2;
      
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw frame with detection boxes (already drawn by backend)
      ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);
      
      // Draw stats overlay
      if (result.detections.length > 0) {
        this.drawStatsOverlay(canvas, ctx, result.detections.length);
      }
    };
    
    img.onerror = () => {
      console.error('Failed to load frame image');
    };
    
    img.src = 'data:image/jpeg;base64,' + result.frame;
  }

  drawStatsOverlay(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, detectionCount: number): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(10, 10, 220, 80);
    
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('🛡️ SafeZone AI', 20, 30);
    
    ctx.font = '14px Arial';
    ctx.fillStyle = '#FF0000';
    ctx.fillText('🔴 LIVE', 20, 55);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`Detections: ${detectionCount}`, 20, 75);
    ctx.fillText('FPS: ~30', 140, 75);
  }

  ngOnDestroy(): void {
    if (!this.isBrowser) return;
    
    console.log('Component destroying, cleaning up...');
    
    // Remove event listener
    window.removeEventListener('beforeunload', this.handlePageUnload);
    
    // Stop everything
    this.stopLocalCamera();
    this.apiService.disconnectWebSocket();
    this.cleanupBackendResources();
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }
}
