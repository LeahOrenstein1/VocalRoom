// Development-only isolated runtime, independent of VocalRoom's production bundle.
import * as ort from './web/node_modules/onnxruntime-web/dist/ort.all.min.mjs';
ort.env.wasm.wasmPaths = new URL('./web/node_modules/onnxruntime-web/dist/', location.href).href;
ort.env.wasm.numThreads = 1;
const output = document.querySelector('#report');
async function run(provider) {
  output.textContent = `Running ${provider}; loading verified spectral model…`;
  const report = {provider, userAgent:navigator.userAgent, crossOriginIsolated, webgpuAvailable:!!navigator.gpu, threads:1};
  let session;
  try {
    const start = performance.now();
    const [model,input,expected] = await Promise.all(['renaissance.onnx','input.bin','expected.bin'].map(async file => {
      const response = await fetch('./outputs/onnx-probe/'+file);
      if(!response.ok) throw new Error(file+': '+response.status);
      return response.arrayBuffer();
    }));
    session = await ort.InferenceSession.create(model,{executionProviders:[provider]});
    report.loadMs = performance.now()-start;
    const tensor = new ort.Tensor('float32',new Float32Array(input),[1,2049,48,2]);
    const t = performance.now();
    const {restored} = await session.run({spectrum:tensor});
    report.inferenceMs=performance.now()-t;
    const reference=new Float32Array(expected),actual=restored.data;
    let squared=0,norm=0,max=0,finite=true;
    for(let i=0;i<actual.length;i++) {
      const error=actual[i]-reference[i];
      squared+=error*error;norm+=reference[i]**2;max=Math.max(max,Math.abs(error));finite&&=Number.isFinite(actual[i]);
    }
    Object.assign(report,{status:'actual_browser_spectral_inference_completed',maxAbsError:max,rmsError:Math.sqrt(squared/actual.length),relativeRms:Math.sqrt(squared/norm),finite,
      jsHeapBytes:performance.memory?.usedJSHeapSize??null,memoryNote:'JS heap excludes WASM linear memory and GPU allocations; not total browser process RSS.'});
  } catch(e) { report.status='blocked';report.error=String(e); }
  finally { if(session) await session.release(); output.textContent=JSON.stringify(report,null,2); }
}
document.querySelector('#wasm').onclick=()=>run('wasm');
document.querySelector('#webgpu').onclick=()=>run('webgpu');
