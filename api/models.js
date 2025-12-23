const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Path to default_scenes directory
    // In Vercel, when outputDirectory is 'viewer', the files are deployed there
    // Try multiple possible paths
    let scenesDir = null;
    const possiblePaths = [
      path.join(process.cwd(), 'viewer', 'default_scenes'),
      path.join(process.cwd(), 'default_scenes'),
      path.join(__dirname, '..', 'viewer', 'default_scenes'),
      path.join(__dirname, '..', 'default_scenes')
    ];
    
    for (const dirPath of possiblePaths) {
      if (fs.existsSync(dirPath)) {
        scenesDir = dirPath;
        break;
      }
    }
    
    if (!scenesDir) {
      throw new Error('default_scenes directory not found. Tried paths: ' + possiblePaths.join(', '));
    }
    
    // Read directory contents
    const files = fs.readdirSync(scenesDir);
    
    // Filter only .glb files
    const glbFiles = files.filter(file => 
      file.toLowerCase().endsWith('.glb')
    ).sort(); // Sort alphabetically
    
    res.status(200).json({
      success: true,
      models: glbFiles
    });
  } catch (error) {
    console.error('Error reading models directory:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to read models directory',
      message: error.message
    });
  }
};

