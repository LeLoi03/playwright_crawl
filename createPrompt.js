import fs from 'fs';
import path from 'path';

async function generatePartsFromFiles(directory, outputDirectory, maxFilesPerPrompt = 10) {
  try {
    // Lấy danh sách các file txt trong thư mục
    const files = (await fs.promises.readdir(directory)).filter(file => file.endsWith('.txt'));

    let partIndex = 1;
    let conferences = [];
    let information = [];

    for (const [globalIndex, file] of files.entries()) {
      const fileName = path.parse(file).name; // Lấy tên file không có phần mở rộng
      const filePath = path.join(directory, file);
      const fileContent = await fs.promises.readFile(filePath, 'utf8'); // Đọc nội dung file
    
      // Tính toán index cho prompt hiện tại
      const localIndex = (globalIndex % maxFilesPerPrompt) + 1;
    
      // Thêm nội dung của file hiện tại vào danh sách
      const conferenceText = `${localIndex}. ${fileName} conference:\n${fileContent.trim()}`;
      const informationText = `${localIndex}. ${fileName} information:`;
      conferences.push(conferenceText);
      information.push(informationText);
    
      // Nếu đạt số file tối đa, ghi ra file prompt và bắt đầu phần mới
      if ((globalIndex + 1) % maxFilesPerPrompt === 0) {
        await savePartsToFile(outputDirectory, partIndex, conferences, information);
        partIndex++;
        conferences = [];
        information = [];
      }
    }

    // Ghi phần còn lại ra file nếu còn dữ liệu
    if (conferences.length > 0 || information.length > 0) {
      await savePartsToFile(outputDirectory, partIndex, conferences, information);
    }

    console.log(`Tất cả phần đã được chia và lưu trong thư mục: ${outputDirectory}`);
  } catch (error) {
    console.error("Error processing files:", error);
  }
}

async function savePartsToFile(outputDirectory, partIndex, conferences, information) {
  const parts =  `input:\n${conferences.join('\n')}\n\noutput:${information.join('\n')}
`
  ;

  const outputFilePath = path.join(outputDirectory, `prompt_${partIndex}.txt`);
  // const formattedParts = JSON.stringify(parts, null, 2);
  await fs.promises.writeFile(outputFilePath, parts, 'utf8');
  console.log(`Đã lưu phần ${partIndex} vào file: ${outputFilePath}`);
}

// Đường dẫn thư mục chứa các file txt
const directoryPath = 'D:/2023-playwright/shorten/test-2023/text-from-html-data';
// Đường dẫn thư mục output
const outputDirectory = './prompts';

// Tạo thư mục output nếu chưa tồn tại
if (!fs.existsSync(outputDirectory)) {
  fs.mkdirSync(outputDirectory);
}

// Gọi hàm xử lý
generatePartsFromFiles(directoryPath, outputDirectory);
