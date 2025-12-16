const fs = require('fs');
const path = require('path');

const versionFilePath = path.join(__dirname, '..', 'version.json');

// Read current version
let versionData;
try {
  versionData = require(versionFilePath);
} catch (error) {
  // If file doesn't exist, start with 1.0.0
  versionData = { version: '1.0.0', lastUpdated: new Date().toISOString() };
}

// Function to increment version
function incrementVersion(version, type = 'patch') {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3) return version; // validación básica

  let [major, minor, patch] = parts;

  switch (type) {
    case 'major':
      major++;
      minor = 0;
      patch = 0;
      break;
    case 'minor':
      minor++;
      patch = 0;
      break;
    case 'patch':
    default:
      patch++;
      break;
  }

  return `${major}.${minor}.${patch}`;
}

// Get update type from arguments (e.g., node update-version.js minor)
const updateType = process.argv[2] || 'patch';

const newVersion = incrementVersion(versionData.version, updateType);
const newVersionData = {
  version: newVersion,
  lastUpdated: new Date().toISOString()
};

fs.writeFileSync(versionFilePath, JSON.stringify(newVersionData, null, 2));

console.log(`Version updated from ${versionData.version} to ${newVersion}`);
