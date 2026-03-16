const { MindARCompiler } = require('mind-ar/src/image-target/compiler');
const fs = require('fs');
const path = require('path');

async function compile() {
  const imagePaths = process.argv.slice(2);

  if (imagePaths.length === 0) {
    console.error('Usage: node compile-marker.js <image1> [image2] [image3] ...');
    console.error('Example: node compile-marker.js poster1.jpg poster2.jpg');
    process.exit(1);
  }

  console.log(`Compiling ${imagePaths.length} image(s):`, imagePaths);

  const compiler = new MindARCompiler();

  // 이미지들 로드
  const imageBuffers = imagePaths.map(p => {
    const fullPath = path.resolve(p);
    console.log(`  Loading: ${fullPath}`);
    return fs.readFileSync(fullPath);
  });

  // 컴파일 (여러 이미지를 하나의 .mind 파일로)
  await compiler.compileImageTargets(imageBuffers, (progress) => {
    console.log('Progress:', Math.round(progress * 100) + '%');
  });

  // .mind 파일로 내보내기
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
