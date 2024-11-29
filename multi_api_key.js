import fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import csv from 'csv-parser';
import { createReadStream } from 'fs';
import path from 'path';

// Danh sách các API key
const apiKeys = [
  "AIzaSyAxMJPBLzIYe0gqh52YoycpAdcZQe2Io04",
  "AIzaSyAVIJMh_hZoVWSte9wwEb4Hkalio31OkJs",
  "AIzaSyCZwi78BoDFn9xWXIWyLCliluDDOuwgFg4",
  "AIzaSyDbVwKlX_cCQ48aKqtPpJVnM4FDZJkoTu0",
  "AIzaSyDMBzZwP3ZHAQ4RAs2kBCQaOgzPzBjmS-g",
  "AIzaSyBtD-6Gyxu8lYnm8d_RDeONyrKVvlVmupU"

];

const systemInstruction = `
Always return result exact format as my sample outputs provided, do not return result in json format and 
return the final output_10 containing the information of the 10 conferences provided in input_10, 
without returning any extra or missing conference and ensuring the correct conferences order as provided in input_10.
`;

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

async function readPromptFile(filePath) {
  try {
    // // Đọc nội dung file với utf-8
    const fileContent = await fs.promises.readFile(filePath, "utf-8");

    // Tách nội dung input và output theo định dạng
    const inputRegex = /input:\s*([\s\S]*?)\s*output:/m;
    const outputRegex = /output:\s*([\s\S]*)/m;
    
    // Kiểm tra và lấy dữ liệu input và output
    const inputMatch = fileContent.match(inputRegex);
    const outputMatch = fileContent.match(outputRegex);

    if (inputMatch && outputMatch) {
      // Giữ lại cả từ "input:" và "output:" trong nội dung trả về
      const inputText = `input_10: \n${inputMatch[1].trim()}`;
      const outputText = `output_10: `; // ${outputMatch[1].trim()}

      return { inputText, outputText };
    } else {
      throw new Error("Không tìm thấy input hoặc output trong file.");
    }
  } catch (error) {
    console.error(`Lỗi khi đọc file '${filePath}':`, error.message);
    return null; // Trả về null khi gặp lỗi
  }
}

export async function readPromptCSV(filePath) {
  return new Promise((resolve, reject) => {
    try {
      const allInputs = [];
      const allOutputs = [];

      createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          const inputText = (row['input:'] || '').trim();
          const outputText = (row['output:'] || '').trim();

          if (inputText) allInputs.push(inputText);
          if (outputText) allOutputs.push(outputText);
        })
        .on('end', () => {
          // Lọc các input/output hợp lệ
          const validInputs = allInputs.filter((input) => input.trim() !== '');
          const validOutputs = allOutputs.filter((output) => output.trim() !== '');

          if (validInputs.length === 0 || validOutputs.length === 0) {
            reject(new Error('Không tìm thấy dữ liệu hợp lệ trong file CSV.'));
          }

          if (validInputs.length !== validOutputs.length) {
            reject(new Error('Số lượng input và output không khớp!'));
          }

          // Xác định số lượng phần tử mỗi phần tư
          const quarterLength = Math.ceil(validInputs.length / 4);

          // Hàm thêm số thứ tự mà không thay đổi cấu trúc của từng phần tử
          const addIndex = (array) =>
            array.length === 0
              ? [] // Nếu mảng rỗng, trả về mảng rỗng
              : array.map((item, idx) => `${idx + 1}. ${item}`); // Bắt đầu từ 1

          // Chia và thêm số thứ tự lại cho từng phần, mỗi phần reset chỉ mục
          const inputPart1 = addIndex(validInputs.slice(0, quarterLength)).join('\n');
          const inputPart2 = addIndex(validInputs.slice(quarterLength, quarterLength * 2)).join('\n');
          const inputPart3 = addIndex(validInputs.slice(quarterLength * 2, quarterLength * 3)).join('\n');
          const inputPart4 = addIndex(validInputs.slice(quarterLength * 3)).join('\n'); // Part 4

          const outputPart1 = addIndex(validOutputs.slice(0, quarterLength)).join('\n');
          const outputPart2 = addIndex(validOutputs.slice(quarterLength, quarterLength * 2)).join('\n');
          const outputPart3 = addIndex(validOutputs.slice(quarterLength * 2, quarterLength * 3)).join('\n');
          const outputPart4 = addIndex(validOutputs.slice(quarterLength * 3)).join('\n'); // Part 4


          resolve({
            inputPart1: `input: \n${inputPart1}`,
            inputPart2: `input: \n${inputPart2}`,
            inputPart3: `input: \n${inputPart3}`,
            inputPart4: `input: \n${inputPart4}`, // Part 4
            outputPart1: `output: \n${outputPart1}`,
            outputPart2: `output: \n${outputPart2}`,
            outputPart3: `output: \n${outputPart3}`,
            outputPart4: `output: \n${outputPart4}`, // Part 4
          });
        })
        .on('error', (error) => {
          reject(new Error(`Lỗi khi đọc file CSV: ${error.message}`));
        });
    } catch (error) {
      reject(new Error(`Lỗi khi xử lý file CSV: ${error.message}`));
    }
  });
}

// Hàm xử lý từng prompt
async function processPrompt(apiKey, filePath, outputFileName) {  
  try {
    const genAI = new GoogleGenerativeAI(apiKey); // Tạo genAI với API key cụ thể
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash-latest",
      systemInstruction: systemInstruction,
    });

    const csvPath = './geminiapi.csv'; // Đường dẫn tới file CSV

    const { inputPart1, inputPart2, inputPart3, inputPart4, 
      outputPart1, outputPart2, outputPart3, outputPart4 } = await readPromptCSV(csvPath);
    
      
    const { inputText, outputText } = await readPromptFile(filePath);
    if (!inputText || !outputText) {
    throw new Error(`Dữ liệu không hợp lệ trong file ${filePath}.`);
    }
  
    const parts = [
      {text: `${inputPart1}`},
      {text: `${outputPart1}`},
      {text: `${inputPart2}`},
      {text: `${outputPart2}`},
      {text: `${inputPart3}`},
      {text: `${outputPart3}`},
      {text: `${inputPart4}`},
      {text: `${outputPart4}`},
      {text: `${inputText}`},
      {text: `${outputText}`}
    ];
    
    const response = await model.generateContent({
      contents: [{ role: "user", parts }],
      generationConfig,
    });

    const responseText = response.response.text();
    const outputPath = `./responses/${outputFileName}`;
    await fs.promises.writeFile(outputPath, responseText, "utf-8");

    // Count tokens in a prompt without calling text generation.
    const countResult = await model.countTokens(parts);
    return countResult.totalTokens; // Trả về số token đã sử dụng

  } catch (error) {
    console.error(`Lỗi với API key ${apiKey} và file ${filePath}:`, error.message);
    if (error.message.includes("503")) {
      const logPath = "./failed_requests_503.txt";
      fs.appendFileSync(logPath, `503 Error: File ${filePath}, API key: ${apiKey}\n`, "utf-8");
    }
    return 0;
  }
}

// Hàm xử lý 1 nhóm file với 1 API key
async function processGroupWithKey(apiKey, keyIndex, batchIndex, files) {
    const fullFilePaths = files.map(fileName => path.join("D:/2023-playwright/prompts", fileName)); // Sử dụng đúng thư mục gốc
    const promises = fullFilePaths.map((filePath, index) => 
      processPrompt(apiKey, filePath, `response_${batchIndex}_${keyIndex}_${index}.txt`)
    );
    return Promise.all(promises); // Gửi tất cả request song song trong nhóm
}


// Hàm xử lý việc nghỉ 1 phút giữa các request
async function run() {
    try {
      const promptDirectory = "D:/2023-playwright/prompts";
      const promptFiles = (await fs.promises.readdir(promptDirectory)).sort((a, b) => a.localeCompare(b));
  
      // Tạo file để lưu tổng token, xóa nội dung cũ nếu file đã tồn tại
      const tokenCountFilePath = './batch_token_counts.txt';
      fs.writeFileSync(tokenCountFilePath, '', 'utf8'); // Xóa nội dung cũ
  
      const filesPerBatch = 10; // Số request mỗi API key xử lý song song
      const totalKeys = apiKeys.length;
  
      // Chia các file theo số lượng API key và batch
      const allBatches = [];
      for (let i = 0; i < promptFiles.length; i += filesPerBatch * totalKeys) {
        const batch = promptFiles.slice(i, i + filesPerBatch * totalKeys);
        allBatches.push(batch);
      }
  
      // Xử lý từng batch
      for (let batchIndex = 0; batchIndex < allBatches.length; batchIndex++) {
        const batch = allBatches[batchIndex];
  
        // Phân chia file trong batch cho từng API key
        const groupedFiles = Array.from({ length: totalKeys }, (_, i) =>
          batch.slice(i * filesPerBatch, (i + 1) * filesPerBatch)
        );
  
        // Chạy song song các nhóm, mỗi nhóm xử lý với 1 API key
        const batchResults = await Promise.all(
          apiKeys.map((apiKey, keyIndex) =>
            processGroupWithKey(apiKey, keyIndex, batchIndex, groupedFiles[keyIndex] || [])
          )
        );
  
        // Tổng kết token cho từng API key và toàn bộ batch
        let totalTokens = 0;
        batchResults.forEach((result, keyIndex) => {
          const keyTokens = result.reduce((sum, tokens) => sum + tokens, 0);
          totalTokens += keyTokens;
  
          // Ghi tổng token của API key vào file
          fs.appendFileSync(
            tokenCountFilePath,
            `Batch ${batchIndex + 1}, API Key ${keyIndex + 1}: ${keyTokens} tokens\n`,
            'utf8'
          );
        });
  
        // Ghi tổng token của cả batch vào file
        fs.appendFileSync(
          tokenCountFilePath,
          `Batch ${batchIndex + 1}, Tổng token: ${totalTokens} tokens\n\n`,
          'utf8'
        );
  
        // Đợi 1 phút sau khi hoàn thành việc gửi 10 request
        console.log(`Batch ${batchIndex + 1} hoàn thành. Waiting for 1 minute before sending next batch...`);
        await new Promise((resolve) => setTimeout(resolve, 65000)); // Nghỉ 1 phút
      }
  
      console.log("All requests processed.");
    } catch (error) {
      console.error("Lỗi trong quá trình xử lý:", error.message);
    }
}
  

(async () => {
  const startTime = Date.now();
  await run();
  const endTime = Date.now();
  const runTime = endTime - startTime;
  console.log(`Time: ${runTime} ms`);
  fs.writeFileSync('callAPI_runtime.txt', `Execution time: ${runTime} ms`);
})();
