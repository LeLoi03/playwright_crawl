import fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import csv from 'csv-parser';
import { createReadStream } from 'fs';
import path from 'path'

// AIzaSyAxMJPBLzIYe0gqh52YoycpAdcZQe2Io04
const apiKey = "AIzaSyAV319MCiDorKNeNykl68MAzlIJk6YRz3g";
const genAI = new GoogleGenerativeAI(apiKey);

const systemInstruction = `
Always return result exact format as my sample outputs provided, do not return result in json format and 
return the final output_10 containing the information of the 10 conferences provided in input_10, 
without returning any extra or missing conference and ensuring the correct conferences order as provided in input_10.
`
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash-latest",
  systemInstruction: systemInstruction,
});

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
    console.error("Lỗi khi đọc file:", error.message);
    return null;
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
          const inputText = (row['input'] || '').trim();
          const outputText = (row['output'] || '').trim();

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
async function processPrompt(filePath, outputFileName, globalIndex) {  
  try {
    const csvPath = './geminiapi.csv'; // Đường dẫn tới file CSV

    const { inputPart1, inputPart2, inputPart3, inputPart4, 
      outputPart1, outputPart2, outputPart3, outputPart4 } = await readPromptCSV(csvPath);
    
      
    const { inputText, outputText } = await readPromptFile(filePath);
  
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
    // const outputPath = `./responses/${outputFileName}`;
    // await fs.promises.writeFile(outputPath, responseText, "utf-8");
    console.log(responseText);

    const countResult = await model.countTokens(
      parts
    );

    // Count tokens in a prompt without calling text generation.
    return countResult.totalTokens; // Trả về số token đã sử dụng

  } catch (error) {
    // Kiểm tra lỗi và ghi log nếu là lỗi 503
    if (error.message.includes('503')) {
      const logFilePath = './failed_requests_503.txt';
      fs.writeFileSync(logFilePath, '', 'utf8'); // Xóa nội dung cũ

      const errorMessage = `Request thất bại (503): File: ${filePath}, Request #${globalIndex}, Lỗi: ${error.message}\n`;

      // Ghi lỗi vào file log
      fs.appendFileSync(logFilePath, errorMessage, 'utf8');
      // console.error(`Lỗi 503 được ghi vào: ${logFilePath}`);
    } else {
      console.error(`Lỗi khi xử lý file ${filePath}:`, error.message);
    }

    return 0; // Trả về 0 nếu có lỗi để tránh gián đoạn
  }
}

// Hàm xử lý việc nghỉ 1 phút giữa các request
async function run() {
  try {
    const promptDirectory = "./prompts";
    let promptFiles = (await fs.promises.readdir(promptDirectory)).sort((a, b) => a.localeCompare(b));

    let globalIndex = 1; // Biến theo dõi chỉ số file response

    // Tạo file để lưu tổng token (nếu chưa tồn tại)
    const tokenCountFilePath = './batch_token_counts.txt';
    fs.writeFileSync(tokenCountFilePath, '', 'utf8'); // Xóa nội dung cũ nếu file đã tồn tại

    // Chạy các request song song, nhưng mỗi lần chỉ gửi 1 request
    while (promptFiles.length > 0) {
      // Lấy 1 file đầu tiên
      const filesToProcess = promptFiles.slice(0, 1);
      const outputFiles = filesToProcess.map(() => `response_${globalIndex++}.txt`); // Đảm bảo chỉ số tăng liên tục

      // Gửi 1 request song song
      const tokenCounts = await Promise.all(
        filesToProcess.map((filePath) =>
          processPrompt(
            path.join(promptDirectory, filePath),
            outputFiles.shift(),
            globalIndex++
          )
        )
      );

      // Tính tổng token của batch
      const batchTotalTokens = tokenCounts.reduce((sum, tokens) => sum + tokens, 0);
      // console.log(`Tổng số token của batch: ${batchTotalTokens}`);

      // Ghi tổng token của batch vào file
      fs.appendFileSync(tokenCountFilePath, `Batch tổng token: ${batchTotalTokens}\n`, 'utf8');

      // Đợi 1 phút sau khi hoàn thành việc gửi 1 request
      console.log("Waiting for 1 minute before sending next batch...");
      await new Promise(resolve => setTimeout(resolve, 65000)); // Nghỉ 1 phút

      // Loại bỏ các file đã xử lý và cập nhật lại danh sách các file chưa xử lý
      promptFiles = promptFiles.slice(1); // Loại bỏ 1 file đầu tiên đã xử lý
    }

    console.log("All requests processed.");

  } catch (error) {
    console.error("Lỗi trong quá trình chạy:", error.message);
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
