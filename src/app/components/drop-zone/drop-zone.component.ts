import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-drop-zone',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="drop-card"
      [class.drag-over]="isDragOver"
      [class.has-file]="hasFile"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
      (click)="fileInput.click()"
    >
      <input
        #fileInput
        type="file"
        [accept]="acceptTypes"
        (change)="onFileSelected($event)"
        style="display: none"
      />

      <div class="drop-card-content">
        <div class="icon-container">
          <span class="icon">{{ icon }}</span>
        </div>
        <div class="text-group">
          <h4 class="title">{{ title }}</h4>
          <p class="subtitle" *ngIf="!fileName">{{ subtitle }}</p>

          <div class="file-badge" *ngIf="fileName">
            <span class="file-name">{{ fileName }}</span>
            <span class="file-size" *ngIf="fileSize">{{ fileSize }}</span>
          </div>
        </div>

        <button type="button" class="browse-btn">
          {{ hasFile ? 'CHANGE' : 'SELECT' }}
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .drop-card {
        border: 1px dashed rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        padding: 14px;
        background: rgba(20, 24, 30, 0.6);
        cursor: pointer;
        transition: all 0.2s ease;
        user-select: none;
      }

      .drop-card:hover {
        border-color: rgba(239, 68, 68, 0.6);
        background: rgba(25, 30, 38, 0.8);
      }

      .drop-card.drag-over {
        border-color: #ef4444;
        background: rgba(239, 68, 68, 0.12);
        box-shadow: 0 0 15px rgba(239, 68, 68, 0.25);
      }

      .drop-card.has-file {
        border-color: rgba(239, 68, 68, 0.5);
        background: rgba(239, 68, 68, 0.08);
      }

      .drop-card-content {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .icon-container {
        width: 40px;
        height: 40px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.2rem;
        flex-shrink: 0;
      }

      .has-file .icon-container {
        background: rgba(239, 68, 68, 0.18);
        border-color: rgba(239, 68, 68, 0.4);
      }

      .text-group {
        flex: 1;
        min-width: 0;
      }

      .title {
        margin: 0;
        font-size: 0.85rem;
        font-weight: 700;
        color: #f3f4f6;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }

      .subtitle {
        margin: 2px 0 0;
        font-size: 0.75rem;
        color: #9ca3af;
      }

      .file-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-top: 4px;
        padding: 2px 8px;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 4px;
        max-width: 100%;
      }

      .file-name {
        font-size: 0.78rem;
        color: #ef4444; // KORA primary red
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .file-size {
        font-size: 0.7rem;
        color: #6b7280;
      }

      .browse-btn {
        padding: 6px 12px;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.8px;
        color: #f3f4f6;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 4px;
        cursor: pointer;
        transition: background 0.2s ease;
      }

      .browse-btn:hover {
        background: rgba(255, 255, 255, 0.18);
        border-color: rgba(239, 68, 68, 0.5);
      }
    `,
  ],
})
export class DropZoneComponent {
  @Input({ required: true }) title!: string;
  @Input({ required: true }) subtitle!: string;
  @Input({ required: true }) icon!: string;
  @Input({ required: true }) acceptTypes!: string;
  @Input() fileName: string | null = null;
  @Input() fileSize: string | null = null;
  @Input() hasFile = false;

  @Output() fileDropped = new EventEmitter<File>();

  isDragOver = false;

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;

    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      this.fileDropped.emit(file);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.fileDropped.emit(input.files[0]);
      input.value = '';
    }
  }
}
