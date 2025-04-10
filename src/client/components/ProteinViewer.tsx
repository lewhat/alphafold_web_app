import React, { useEffect, useRef, useState } from 'react';

interface ProteinViewerProps {
  structureData?: string;
  storageUrl?: string;
  height?: number | string;
}

const Protein3DViewer: React.FC<ProteinViewerProps> = ({ 
  structureData, 
  storageUrl,
  height = 500
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sequenceRef = useRef<HTMLDivElement>(null);
  const viewerInitializedRef = useRef(false);
  const [viewerInstance, setViewerInstance] = useState<any>(null);
  const [showSequence, setShowSequence] = useState(false);
  const [proteinChains, setProteinChains] = useState<any[]>([]);
  const [activeChain, setActiveChain] = useState<string>('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [showControls, setShowControls] = useState(true);

  useEffect(() => {
    // Load 3Dmol.js script if not already loaded
    if (!window.$3Dmol) {
      const script = document.createElement('script');
      script.src = 'https://3Dmol.org/build/3Dmol-min.js';
      script.async = true;
      script.onload = () => initViewer();
      document.body.appendChild(script);
      
      // Also load jQuery if needed (3Dmol dependency)
      if (!window.jQuery) {
        const jqueryScript = document.createElement('script');
        jqueryScript.src = 'https://code.jquery.com/jquery-3.6.0.min.js';
        jqueryScript.async = true;
        document.body.appendChild(jqueryScript);
      }
      
      return () => {
        document.body.removeChild(script);
      };
    } else {
      initViewer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-initialize viewer when props change
  useEffect(() => {
    if (window.$3Dmol && viewerInitializedRef.current) {
      initViewer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureData, storageUrl]);

  const initViewer = async () => {
    if (!containerRef.current || (!structureData && !storageUrl) || !window.$3Dmol) {
      return;
    }

    try {
      containerRef.current.innerHTML = '';
      
      // Initialize the viewer with controls
      const viewer = window.$3Dmol.createViewer(containerRef.current, {
        backgroundColor: 'black',
        antialias: true,
        id: 'protein-viewer-' + Date.now()
      });
      
      setViewerInstance(viewer);
      
      if (!viewer) {
        console.error('Failed to create 3Dmol viewer');
        return;
      }

      let modelData;
      if (storageUrl) {
        console.log(storageUrl)
        const fetchResponse = await fetch(storageUrl);
        modelData = await fetchResponse.text();
        viewer.addModel(modelData, 'pdb');
      } else if (structureData) {
        modelData = structureData;
        viewer.addModel(structureData, 'pdb');
      }
      
      // Add ribbon/cartoon representation
      viewer.setStyle({}, { 
        cartoon: { 
          color: 'spectrum',
          thickness: 0.8,
          opacity: 1.0
        } 
      });
      
      if (modelData) {
        const chains = extractChains(modelData);
        setProteinChains(chains);
        if (chains.length > 0) {
          setActiveChain(chains[0].id);
        }
      }
      
      viewer.setViewStyle({ style: 'outline' });
      viewer.zoomTo();
      
      viewer.rotate(20, { x: 1, y: 1, z: 0 }, 1500);
      
      viewer.render();
      
      viewerInitializedRef.current = true;
      
      viewer.setHoverable({}, true, function(atom: any) {
        if (atom) {
          viewer.addLabel(atom.resn + " " + atom.resi, 
            { position: { x: atom.x, y: atom.y, z: atom.z }, 
              backgroundColor: "black", 
              fontColor: "white", 
              fontSize: 12 });
        } else {
          viewer.removeAllLabels();
        }
        viewer.render();
      });
    } catch (error) {
      console.error('Error initializing 3DMol viewer:', error);
    }
  };

  const extractChains = (pdbData: string): any[] => {
    const chains: any = {};
    const lines = pdbData.split('\n');
    
    lines.forEach(line => {
      if (line.startsWith('ATOM') || line.startsWith('HETATM')) {
        // PDB format: columns are fixed width
        const chainId = line.substring(21, 22).trim();
        const resName = line.substring(17, 20).trim();
        const resNum = parseInt(line.substring(22, 26).trim());
        
        if (!chains[chainId]) {
          chains[chainId] = {
            id: chainId,
            residues: new Map(),
            sequence: ''
          };
        }
        
        if (!chains[chainId].residues.has(resNum)) {
          chains[chainId].residues.set(resNum, resName);
          // Add to sequence - simplified, using one-letter codes where possible
          const oneLetter = threeToOne(resName);
          chains[chainId].sequence += oneLetter;
        }
      }
    });
    
    return Object.values(chains);
  };

  // Function to convert 3-letter amino acid code to 1-letter
  const threeToOne = (three: string): string => {
    const map: {[key: string]: string} = {
      'ALA': 'A', 'ARG': 'R', 'ASN': 'N', 'ASP': 'D', 'CYS': 'C',
      'GLN': 'Q', 'GLU': 'E', 'GLY': 'G', 'HIS': 'H', 'ILE': 'I',
      'LEU': 'L', 'LYS': 'K', 'MET': 'M', 'PHE': 'F', 'PRO': 'P',
      'SER': 'S', 'THR': 'T', 'TRP': 'W', 'TYR': 'Y', 'VAL': 'V'
    };
    
    return map[three] || 'X';
  };

  // Function to change representation style
  const changeStyle = (style: string) => {
    if (!viewerInstance) return;
    
    if (style === 'cartoon') {
      viewerInstance.setStyle({}, { cartoon: { color: 'spectrum' } });
    } else if (style === 'stick') {
      viewerInstance.setStyle({}, { stick: { colorscheme: 'element', radius: 0.15 } });
    } else if (style === 'sphere') {
      viewerInstance.setStyle({}, { sphere: { colorscheme: 'element', radius: 0.8 } });
    } else if (style === 'line') {
      viewerInstance.setStyle({}, { line: { colorscheme: 'element', linewidth: 1.5 } });
    }
    
    viewerInstance.render();
  };

  // Function to highlight specific residues by their number
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const highlightResidue = (chainId: string, resNum: number) => {
    if (!viewerInstance) return;
    
    viewerInstance.setStyle({}, { 
      cartoon: { color: 'spectrum' }
    });
    
    viewerInstance.setStyle({chain: chainId, resi: resNum}, {
      cartoon: { color: 'red', thickness: 1.2 },
      stick: { colorscheme: 'element', radius: 0.15 }
    });
    
    viewerInstance.render();
  };

  return (
    <div className="flex flex-col items-center w-full">
      <div
        ref={containerRef}
        className="w-full border rounded"
        style={{ position: 'relative', height: typeof height === 'number' ? `${height}px` : height }}
      />
      
      {/* Controls */}
      {showControls && (
        <div className="w-full my-2 p-2 border rounded bg-gray-50">
          <div className="flex flex-wrap justify-between items-center">
            <div>
              <span className="mr-2">Style:</span>
              <button 
                onClick={() => changeStyle('cartoon')}
                className="px-2 py-1 mr-1 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Cartoon
              </button>
              <button 
                onClick={() => changeStyle('stick')}
                className="px-2 py-1 mr-1 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Stick
              </button>
              <button 
                onClick={() => changeStyle('sphere')}
                className="px-2 py-1 mr-1 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Sphere
              </button>
              <button 
                onClick={() => changeStyle('line')}
                className="px-2 py-1 mr-1 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Line
              </button>
            </div>
            
            <div>
              <button 
                onClick={() => setShowSequence(!showSequence)}
                className="px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                {showSequence ? 'Hide Sequence' : 'Show Sequence'}
              </button>
            </div>
          </div>
          
          {/* Chain selection */}
          {proteinChains.length > 1 && (
            <div className="mt-2">
              <span className="mr-2">Chain:</span>
              {proteinChains.map(chain => (
                <button 
                  key={chain.id}
                  onClick={() => setActiveChain(chain.id)}
                  className={`px-2 py-1 mr-1 rounded ${activeChain === chain.id ? 'bg-green-500 text-white' : 'bg-gray-200'}`}
                >
                  {chain.id || 'Default'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* Sequence display */}
      {showSequence && proteinChains.length > 0 && (
        <div 
          ref={sequenceRef}
          className="w-full mt-2 p-3 border rounded bg-white overflow-x-auto"
        >
          <h3 className="font-bold mb-1">Chain {activeChain || 'Default'} Sequence:</h3>
          <div className="text-xs font-mono whitespace-pre-wrap">
            {proteinChains.find(c => c.id === activeChain)?.sequence.match(/.{1,10}/g)?.map((chunk: string, i: number) => (
              <span key={i} className="mr-2">{chunk}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};



export default Protein3DViewer;
