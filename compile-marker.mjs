import { MindARCompiler } from 'mind-ar/src/image-target/compiler.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function compile() {
  const imagePaths = process.argv.slice(2);

  if (imagePaths.length === 0) {
    console.error('Usage: node compile-marker.mjs <image1> [image2] ...');
    console.error('Example: node compile-marker.mjs poster1.jpg poster2.jpg');
    process.exit(1);
  }

  console.log(`Compiling ${imagePaths.length} image(s):`, imagePaths);

  const compiler = new MindARCompiler();

  const imageBuffers = imagePaths.map(p => {
    const fullPath = path.resolve(p);
    console.log(`  Loading: ${fullPath}`);
    return fs.readFileSync(fullPath);
  });

  await compiler.compileImageTargets(imageBuffers, (progress) => {
    console.log('Progress:', Math.round(progress * 100) + '%');
  });

  const exportedData = await compiler.exportData();

  const outputPath = path.join(__dirname, 'assets', 'marker', 'targets.mind');
  fs.writeFileSync(outputPath, Buffer.from(exportedData));

  console.log(`Done! ${imagePaths.length} target(s) compiled to: ${outputPath}`);
  console.log('Target indices:');
  imagePaths.forEach((p, i) => {
    console.log(`  targetIndex ${i}: ${path.basename(p)}`);
  });
}

compile().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
