import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Định nghĩa __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình
const MAX_TABS = 5; // Số lượng tab chạy song song
const BASE_URL = `https://www.scimagojr.com/journalrank.php?year=2023&type=j`;
const OUTPUT_FILE = path.join(__dirname, 'journal_with_country.csv');
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// Tiêu đề của file CSV
const CSV_HEADERS = `Title,Type,SJR,H index,Total Docs. (2023),Total Docs. (3years),Total Refs. (2023),Total Cites (3years),Citable Docs. (3years),Cites / Doc. (2years),Ref. / Doc. (2023),%Female (2023),Country\n`;

// Hàm xử lý từng trang
const processPage = async (page, url) => {
  try {
    console.log(`Đang xử lý URL: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Lấy dữ liệu bảng
    const tableData = await page.evaluate(() => {
      const traverseNodes = (node) => {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent.trim();
        } else if (node.nodeType === Node.ELEMENT_NODE && node.childNodes.length > 0) {
          return Array.from(node.childNodes).map(traverseNodes).join(' ').trim();
        }
        return '';
      };

      const processTable = (table) => {
        let tableText = '';
        const rows = table.querySelectorAll('tbody tr');
        if (rows.length === 0) return tableText;

        rows.forEach((row) => {
          const cells = row.querySelectorAll('td');
          let rowText = '';

          cells.forEach((cell, index) => {
            // Bỏ qua ô đầu tiên (số thứ tự)
            if (index === 0) return;

            // Thêm các ô nội dung
            if (index < cells.length - 1) {
              rowText += traverseNodes(cell) + ',';
            } else {
              // Lấy thông tin "Country" từ thuộc tính title
              const country = cell.querySelector('img')?.getAttribute('title') || 'N/A';
              rowText += country;
            }
          });

          tableText += rowText + '\n';
        });

        return tableText.trim();
      };

      const table = document.querySelector('body > div.ranking_body > div.table_wrap > table');
      return table ? processTable(table) : '';
    });

    return tableData;
  } catch (error) {
    console.error(`Lỗi khi xử lý URL: ${url}`, error);
    return null;
  }
};

// Chương trình chính
(async () => {
  const browser = await chromium.launch({
    headless: false, // Chạy headless (ẩn trình duyệt)
    executablePath: EDGE_PATH, // Đường dẫn trình duyệt Edge (hoặc Chromium)
  });

  // Tạo context trình duyệt
  const context = await browser.newContext();

  // Chặn tài nguyên không cần thiết
  await context.route("**/*", (route) => {
    const request = route.request();
    const resourceType = request.resourceType(); // Loại tài nguyên
    const url = request.url(); // URL yêu cầu

    if (
      ['image', 'media', 'font', 'stylesheet', 'script'].includes(resourceType) || // Loại bỏ tài nguyên không cần thiết
      url.includes("google-analytics") || // Chặn analytics
      url.includes("ads") ||              // Chặn quảng cáo
      url.includes("tracking") ||         // Chặn tracking
      url.includes("google_vignette")
    ) {
      route.abort(); // Bỏ qua yêu cầu
    } else {
      route.continue(); // Tiếp tục yêu cầu
    }
  });

  // Tạo nhiều tab từ context
  const pages = await Promise.all(Array.from({ length: MAX_TABS }, () => context.newPage()));

  console.log('Bắt đầu crawl dữ liệu...');

  // Tìm số trang cuối
  const firstPage = pages[0];
  await firstPage.goto(`${BASE_URL}&page=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const lastPageNumber = await firstPage.evaluate(() => {
    const text = document
      .querySelector('body > div.ranking_body > div:nth-child(9) > div')
      .textContent.trim();
    const totalItems = parseInt(text.split('of')[1].trim());
    return Math.ceil(totalItems / 50); // Số trang = tổng số mục / 50
  });

  console.log(`Tổng số trang: ${lastPageNumber}`);
  const urls = Array.from({ length: lastPageNumber }, (_, i) => `${BASE_URL}&page=${i + 1}`);
  const results = [];

  // Crawl song song
  for (let i = 0; i < urls.length; i += MAX_TABS) {
    const batch = urls.slice(i, i + MAX_TABS);
    const dataBatch = await Promise.all(
      batch.map((url, idx) => processPage(pages[idx], url))
    );

    dataBatch.forEach((data) => {
      if (data) results.push(data);
    });
  }

  // Ghi dữ liệu vào file CSV
  fs.writeFileSync(OUTPUT_FILE, CSV_HEADERS + results.join('\n'), 'utf8');
  console.log(`Dữ liệu đã được lưu vào: ${OUTPUT_FILE}`);

  await browser.close();
})();
