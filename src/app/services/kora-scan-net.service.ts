import { Injectable } from '@angular/core';

/** Non-destructive A3 print extraction.
 *
 * The previous template masks were in the wrong positions for perspective-
 * distorted WhatsApp photos, deleting handwriting and even entire panels.
 * Detect the actual faint neutral-grey print strokes in the SCAN instead.
 * Three overlapping envelopes protect the whole connected football net,
 * including artwork extending across printed seams. No individual face is
 * transformed, edited or cropped.
 */
@Injectable({ providedIn: 'root' })
export class KoraScanNetService {
  private readonly width = 725;
  private readonly height = 1024;

  private hull(points: number[][]): number[][] {
    points.sort((a,b) => a[0]-b[0] || a[1]-b[1]);
    const cross=(a:number[],b:number[],c:number[]):number =>
      (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
    const lower:number[][]=[], upper:number[][]=[];
    for(const point of points) {
      while(lower.length>=2 && cross(lower[lower.length-2],lower[lower.length-1],point)<=0)
        lower.pop();
      lower.push(point);
    }
    for(let i=points.length-1;i>=0;i--) {
      const point=points[i];
      while(upper.length>=2 && cross(upper[upper.length-2],upper[upper.length-1],point)<=0)
        upper.pop();
      upper.push(point);
    }
    return lower.slice(0,-1).concat(upper.slice(0,-1));
  }

  render(source: HTMLCanvasElement): HTMLCanvasElement {
    if(source.width<300 || source.height<400)
      throw new Error('A full-resolution A3 page is needed to locate its print.');

    const probe=document.createElement('canvas');
    probe.width=this.width;probe.height=this.height;
    const pctx=probe.getContext('2d',{willReadFrequently:true});
    if(!pctx)throw new Error('Cannot analyze the A3 print');
    pctx.drawImage(source,0,0,this.width,this.height);
    const pixels=pctx.getImageData(0,0,this.width,this.height).data;
    // Zones overlap deliberately. The source layout has three connected
    // runs: upper, broad middle and lower. This excludes the QR and page
    // instructions without trying to identify handwriting or trim a panel.
    const zones=[
      [330,45,600,265],
      [205,210,670,665],
      [195,620,575,945]
    ];
    const hulls:number[][][]=[];
    for(const [left,top,right,bottom] of zones){
      const points:number[][]=[];
      for(let y=top;y<bottom;y+=2)for(let x=left;x<right;x+=2){
        const i=(y*this.width+x)*4;
        const r=pixels[i],g=pixels[i+1],b=pixels[i+2];
        const max=Math.max(r,g,b),min=Math.min(r,g,b);
        const average=(r+g+b)/3;
        // Neutral printed outline: saturated red/blue marker ink is ignored.
        if(max-min<18 && average>=145 && average<248)
          points.push([x,y]);
      }
      // An unrecognized print must not be hidden by an empty guessed mask.
      if(points.length<70)
        throw new Error('Could not identify all printed football outlines. Please use the full A3 source image.');
      const hull=this.hull(points);
      if(hull.length<3)throw new Error('Invalid scanned football outline');
      hulls.push(hull);
    }

    const all=hulls.flat();
    const minX=Math.min(...all.map(p=>p[0]))-29;
    const maxX=Math.max(...all.map(p=>p[0]))+29;
    const minY=Math.min(...all.map(p=>p[1]))-29;
    const maxY=Math.max(...all.map(p=>p[1]))+29;
    const left=Math.max(0,Math.floor(minX)),right=Math.min(this.width,Math.ceil(maxX));
    const top=Math.max(0,Math.floor(minY)),bottom=Math.min(this.height,Math.ceil(maxY));
    const cropW=right-left,cropH=bottom-top;
    const sx=source.width/this.width,sy=source.height/this.height;
    const sourceX=left*sx,sourceY=top*sy;
    const sourceW=cropW*sx,sourceH=cropH*sy;
    // A uniform scale, measured in source pixels, preserves every panel.
    const scale=Math.min(976/sourceW,976/sourceH);
    const drawW=sourceW*scale,drawH=sourceH*scale;
    const dx=(1024-drawW)/2,dy=(1024-drawH)/2;

    const art=document.createElement('canvas');
    art.width=1024;art.height=1024;
    const actx=art.getContext('2d');
    if(!actx)throw new Error('Cannot render the source artwork');
    actx.drawImage(source,sourceX,sourceY,sourceW,sourceH,dx,dy,drawW,drawH);

    const mask=document.createElement('canvas');
    mask.width=1024;mask.height=1024;
    const mctx=mask.getContext('2d');
    if(!mctx)throw new Error('Cannot retain the complete football outline');
    mctx.fillStyle='#fff';
    mctx.strokeStyle='#fff';
    mctx.lineJoin='round';mctx.lineCap='round';
    // 28 pixels of protective outward margin in the analysis space.
    mctx.lineWidth=56*Math.min(sx,sy)*scale;
    for(const hull of hulls){
      mctx.beginPath();
      hull.forEach(([x,y],i)=>{
        const u=dx+(x*sx-sourceX)*scale;
        const v=dy+(y*sy-sourceY)*scale;
        if(i===0)mctx.moveTo(u,v);
        else mctx.lineTo(u,v);
      });
      mctx.closePath();mctx.fill();mctx.stroke();
    }

    actx.globalCompositeOperation='destination-in';
    actx.drawImage(mask,0,0);
    actx.globalCompositeOperation='source-over';
    const result=document.createElement('canvas');
    result.width=1024;result.height=1024;
    const ctx=result.getContext('2d');
    if(!ctx)throw new Error('Cannot build 1:1 white ball texture');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,1024,1024);
    ctx.drawImage(art,0,0);
    return result;
  }
}
