import { Injectable } from '@angular/core';
import { KORA_UV_PANEL_CORNERS } from './kora-uv-panel-corners';

/** Renders the corrected children's drawing onto the ACTUAL OBJ panel UV
 * islands. The intermediate cropped/centered 1:1 image is NOT used:
 * its padding is not the OBJ UV layout and was the source of the shift.
 *
 * Each printed pentagon/hexagon is mapped by a piecewise affine triangle
 * fan from its registered source outline to the corresponding OBJ UV island.
 * All sampling stays inside that panel; UV gutters are white with tiny
 * edge-color extension to prevent white seams at bilinear texture edges.
 */
@Injectable({ providedIn: 'root' })
export class KoraUvAlignService {
  render(source: HTMLCanvasElement, sourcePanels: number[][][]): HTMLCanvasElement {
    if (sourcePanels.length !== 32 || KORA_UV_PANEL_CORNERS.length !== 32)
      throw new Error('Expected 32 printed panels and 32 OBJ UV panels.');
    if (source.width < 2 || source.height < 2)
      throw new Error('Corrected paper must contain source pixels.');
    // Reject malformed or mirrored registrations rather than silently painting
    // the wrong face of a panel. Both datasets use clockwise screen coordinates.
    const twiceArea=(points:number[][]):number=>points.reduce((sum,p,i)=>{
      const q=points[(i+1)%points.length];
      return sum+p[0]*q[1]-q[0]*p[1];
    },0);
    for(let panel=0;panel<32;panel++){
      const from=sourcePanels[panel],to=KORA_UV_PANEL_CORNERS[panel];
      if(!Array.isArray(from) || from.length!==to.length || (to.length!==5 && to.length!==6))
        throw new Error('Panel '+(panel+1)+' UV corner count does not match print.');
      if(![...from,...to].every(p=>p.length===2 && p.every(Number.isFinite)))
        throw new Error('Non-finite panel corner on panel '+(panel+1));
      if(to.some(([x,y])=>x<0 || y<0 || x>1024 || y>1024))
        throw new Error('UV corner outside atlas on panel '+(panel+1));
      if(twiceArea(from)<1 || twiceArea(to)<1)
        throw new Error('Degenerate or mirrored panel '+(panel+1));
    }
    const sourceCtx=source.getContext('2d',{willReadFrequently:true});
    if(!sourceCtx)throw new Error('Cannot read corrected panel artwork');
    const image=sourceCtx.getImageData(0,0,source.width,source.height);
    const sw=source.width,sh=source.height,size=1024;
    const output=new Uint8ClampedArray(size*size*4);
    output.fill(255); // solid white final ball texture
    const occupied=new Uint8Array(size*size);

    for(let panel=0;panel<32;panel++){
      const from=sourcePanels[panel],to=KORA_UV_PANEL_CORNERS[panel];
      if(from.length!==to.length || (from.length!==5 && from.length!==6))
        throw new Error('Panel '+(panel+1)+' UV corner count does not match print.');
      const mean=(points:number[][]):number[]=>[
        points.reduce((a,p)=>a+p[0],0)/points.length,
        points.reduce((a,p)=>a+p[1],0)/points.length
      ];
      const srcCenter=mean(from),dstCenter=mean(to);
      for(let edge=0;edge<to.length;edge++){
        const next=(edge+1)%to.length;
        const [a,b,c]=[dstCenter,to[edge],to[next]];
        const [sa,sb,sc]=[srcCenter,from[edge],from[next]];
        const ax=b[0]-a[0],ay=b[1]-a[1],bx=c[0]-a[0],by=c[1]-a[1];
        const det=ax*by-ay*bx;
        if(Math.abs(det)<.001)throw new Error('Degenerate UV triangle on panel '+(panel+1));
        const minX=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0])));
        const maxX=Math.min(size-1,Math.ceil(Math.max(a[0],b[0],c[0])));
        const minY=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1])));
        const maxY=Math.min(size-1,Math.ceil(Math.max(a[1],b[1],c[1])));
        for(let y=minY;y<=maxY;y++){
          for(let x=minX;x<=maxX;x++){
            const px=x+.5-a[0],py=y+.5-a[1];
            const wb=(px*by-py*bx)/det;
            const wc=(ax*py-ay*px)/det;
            const wa=1-wb-wc;
            if(wa < -1e-5 || wb < -1e-5 || wc < -1e-5)continue;
            const sx=wa*sa[0]+wb*sb[0]+wc*sc[0];
            const sy=wa*sa[1]+wb*sb[1]+wc*sc[1];
            if(sx<0||sy<0||sx>=sw-1||sy>=sh-1)continue;
            const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
            const base=(iy*sw+ix)*4,below=base+sw*4;
            const dest=y*size+x;
            // The islands are disjoint: never let a neighboring polygon
            // overwrite a texel belonging to an earlier island.
            if(occupied[dest])continue;
            const out=dest*4;
            // Preserve photographed color with bilinear interpolation. The
            // printed source has an opaque white paper background.
            for(let channel=0;channel<3;channel++){
              output[out+channel]=Math.round(
                image.data[base+channel]*(1-fx)*(1-fy)+
                image.data[base+4+channel]*fx*(1-fy)+
                image.data[below+channel]*(1-fx)*fy+
                image.data[below+4+channel]*fx*fy
              );
            }
            occupied[dest]=1;
          }
        }
      }
    }

    // Extend edge texels one pixel into OBJ UV gaps. This avoids white
    // hairlines when Babylon samples across island boundaries.
    const original=occupied.slice();
    for(let y=1;y<size-1;y++){
      for(let x=1;x<size-1;x++){
        const i=y*size+x;
        if(original[i])continue;
        const neighbors=[i-1,i+1,i-size,i+size];
        for(const near of neighbors)if(original[near]){
          output[i*4]=output[near*4];
          output[i*4+1]=output[near*4+1];
          output[i*4+2]=output[near*4+2];
          break;
        }
      }
    }
    const canvas=document.createElement('canvas');
    canvas.width=size;canvas.height=size;
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Cannot create UV-matched texture');
    ctx.putImageData(new ImageData(output,size,size),0,0);
    return canvas;
  }
}
