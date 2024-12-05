import dotenv from "dotenv";
import { JSDOM } from "jsdom";
import playwright from "playwright";
import fs from "fs"; // Sử dụng `fs/promises` thay vì callback-based `fs`
import PQueue from "p-queue";

dotenv.config(); // Tải biến môi trường từ file .env

const queue = new PQueue({ concurrency: 5 }); // Giới hạn 5 tác vụ đồng thời
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';


const getConferenceList = async (browserContext) => {
  const baseUrl = `${process.env.PORTAL}?search=&by=${process.env.BY}&source=${process.env.CORE}&sort=${process.env.SORT}&page=`;

  const totalPages = await getTotalPages(browserContext, baseUrl + "1");
  const allConferences = [];

  for (let i = 1; i <= totalPages; i++) {
    const pageUrl = baseUrl + i;

    // Dùng hàng đợi để giới hạn số tab hoạt động
    await queue.add(async () => {
      try {
        const conferences = await getConferencesOnPage(browserContext, pageUrl);
        console.log(`Page ${i} processed successfully.`);
        allConferences.push(...conferences);
      } catch (error) {
        console.error(`Error processing page ${i}: ${error.message}`);
      }
    });
  }

  await queue.onIdle(); // Đợi hàng đợi hoàn thành
  console.log(allConferences.length)
  return allConferences;
};


const searchConferenceLinks = async (browserContext, conference) => {
  const maxLinks = 4;
  const links = [];
  const page = await browserContext.newPage();

  // Tắt tài nguyên không cần thiết
  await page.route("**/*", (route) => {
    const request = route.request();
    const resourceType = request.resourceType();

    if (
      ['image', 'media', 'font', 'stylesheet', 'script'].includes(resourceType) ||
      request.url().includes("google-analytics") ||
      request.url().includes("ads") ||
      request.url().includes("tracking")
    ) {
      route.abort(); // Bỏ qua yêu cầu
    } else {
      route.continue(); // Tiếp tục yêu cầu
    }
  });

  let timeout; // Biến để kiểm soát timeout

  try {
    // Đặt timeout toàn bộ cho quá trình tìm kiếm
    timeout = setTimeout(() => {
      console.warn("Search process is taking too long. Closing the page.");
      page.close();
    }, 60000); // 60 giây

    // Truy cập Google
    await page.goto('https://www.google.com/', { waitUntil: 'load', timeout: 60000 });

    // Tìm hộp tìm kiếm và nhập từ khóa
    await page.waitForSelector("#APjFqb", { timeout: 30000 });
    await page.fill("#APjFqb", `${conference.Title} ${conference.Acronym} 2023`);
    await page.press("#APjFqb", "Enter");
    await page.waitForSelector("#search");

    const unwantedDomains = [
      "scholar.google",
      "translate.google",
      "google.com",
      "wikicfp.com",
      "dblp.org",
      "medium.com",
      "dl.acm.org",
      "easychair.org",
      "youtube.com",
      "https://portal.core.edu.au/conf-ranks/",
      "facebook.com",
      "amazon.com",
      "wikipedia.org",
      "linkedin.com",
      "springer.com",
      "proceedings.com"
    ];

    // Lấy liên kết
    while (links.length < maxLinks) {
      const newLinks = await page.$$eval("#search a", (elements) => {
        return elements
          .map((el) => el.href)
          .filter((href) => href && href.startsWith("https://"));
      });

      newLinks.forEach((link) => {
        if (
          !links.includes(link) &&
          !unwantedDomains.some((domain) => link.includes(domain)) &&
          !link.includes("2024") &&
          links.length < maxLinks
        ) {
          links.push(link);
        }
      });

      if (links.length < maxLinks) {
        await page.keyboard.press("PageDown");
        await page.waitForTimeout(2000);
      } else {
        break;
      }
    }

  } catch (error) {
    console.error(`Error while searching for conference links: ${error.message}`);
  } finally {
    // Xóa timeout nếu trang kết thúc sớm
    if (timeout) clearTimeout(timeout);

    // Đóng trang
    await page.close();
  }

  return links.slice(0, maxLinks);
};


const saveHTMLFromCallForPapers = async (page, conference, i) => {
  try {
    const tabs = [
      "cfp",
      "paper",
      "call",
      "research",
      "track"
    ];

    const clickableElements = await page.$$eval("a", (els) => {
      return els.map((el) => ({
        url: el.href.toLowerCase(),
        tag: el.tagName.toLowerCase(),
        element: el.outerHTML
      }));
    });

    // Tạo mảng để lưu các đường link Call for Papers
    const cfpLinks = [];
    let foundTab = false;

    for (const tab of tabs) {
      const matchedElement = clickableElements.find((el) => el.url.includes(tab.toLowerCase()));

      if (matchedElement) {
        // console.log(`\nFound tab '${tab}' in <${matchedElement.tag}> by URL`);

        await page.evaluate(el => {
          const element = new DOMParser().parseFromString(el, 'text/html').body.firstChild;
          element.click();
        }, matchedElement.element);

        // Đợi một thời gian ngắn để trang tải nội dung sau khi nhấp vào
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Lấy URL của trang hiện tại sau khi nhấp vào tab Call for Papers
        const currentURL = page.url();
        cfpLinks.push(currentURL);  // Lưu URL vào mảng cfpLinks


        // Lấy nội dung từ tất cả các phần tử có chứa thuộc tính "main"
        let mainContent = await page.$$eval("*", (els) => {
          return els
            .filter(el => Array.from(el.attributes).some(attr => attr.name.toLowerCase().includes("main")))
            .map(el => el.outerHTML)
            .join("\n\n");
        });

        if (!mainContent) {
          mainContent = await page.content();
        }
        // console.log("\nNo 'main' content found on the Call for Papers page.");


        // Lưu nội dung vào file .txt trong thư mục text-from-cfp-data
        const outputFilePath = `${conference.Acronym}_${i}`;

        // Kiểm tra và tạo thư mục text-from-cfp-data nếu chưa tồn tại
        if (!fs.existsSync("./text-from-cfp-data")) {
          fs.mkdirSync("./text-from-cfp-data");
        }

        const txtFilename = `./text-from-cfp-data/${outputFilePath}.txt`;
        fs.writeFileSync(txtFilename, mainContent);  // Lưu nội dung của phần main
        // console.log(`\nExtracted and saved CFP content successfully: ${outputFilePath}`);

        // Lưu URL vào tệp JSON trong thư mục cfp-link
        if (!fs.existsSync("./cfp-link")) {
          fs.mkdirSync("./cfp-link");
        }

        // Tạo file json lưu đường link
        const linksFilename = `./cfp-link/${conference.Acronym}_${i}.json`;
        fs.writeFileSync(linksFilename, JSON.stringify(cfpLinks, null, 2));
        // console.log(`\nSaved CFP links to: ${linksFilename}`);

        foundTab = true;
        break;  // Dừng sau khi tìm được tab "Call for Paper"
      }
    }

    // Nếu không tìm thấy tab nào phù hợp
    if (!foundTab) {
      // console.log(`\nNo 'Call for Papers' section found for ${conference.Acronym}`);
    }

  } catch (error) {
    console.log("\nError in saveHTMLFromCallForPapers:", error);
    
  }
};

const saveHTMLFromImportantDates = async (page, conference, i) => {
  try {
    const tabs = [
      "importantdates",
      "dates",
    ];

    const clickableElements = await page.$$eval("a", (els) => {
      return els.map((el) => ({
        url: el.href.toLowerCase(),
        tag: el.tagName.toLowerCase(),
        element: el.outerHTML
      }));
    });

    const importantDatesLinks = [];
    let foundTab = false;

    for (const tab of tabs) {
      // Tạo biểu thức chính quy để tìm từ khóa chính xác
      const regex = new RegExp(`\\b${tab}\\b`, "i");  // "\\b" là giới hạn từ (word boundary), "i" là không phân biệt hoa thường

      const matchedElement = clickableElements.find((el) => regex.test(el.url));

      if (matchedElement) {
        // console.log(`\nFound tab '${tab}' in <${matchedElement.tag}> by URL`);
        foundTab = true;

        await page.evaluate(el => {
          const element = new DOMParser().parseFromString(el, 'text/html').body.firstChild;
          element.click();
        }, matchedElement.element);

        await new Promise(resolve => setTimeout(resolve, 5000));

        const currentURL = page.url();
        importantDatesLinks.push(currentURL);

        // await page.goto(currentURL, { waitUntil: "domcontentloaded" });

        const htmlContent = await page.content();

        if (!fs.existsSync("./important-dates-data")) {
          fs.mkdirSync("./important-dates-data");
        }

        const outputFilePath = `${conference.Acronym}_${i}`;

        if (!fs.existsSync("./text-from-important-dates")) {
          fs.mkdirSync("./text-from-important-dates");
        }

        const txtFilename = `./text-from-important-dates/${outputFilePath}.txt`;
        extractTextFromHTML(htmlContent, txtFilename);
        // console.log(`\nExtracted and saved Important Dates successfully: ${outputFilePath}`);

        if (!fs.existsSync("./important-dates-link")) {
          fs.mkdirSync("./important-dates-link");
        }

        const linksFilename = `./important-dates-link/${conference.Acronym}_${i}.json`;
        fs.writeFileSync(linksFilename, JSON.stringify(importantDatesLinks, null, 2));
        // console.log(`\nSaved Important Dates links to: ${linksFilename}`);

        break;
      }
    }

    if (!foundTab) {
      // console.log(`No 'Important Dates' section found for ${conference.Acronym}`);
    }

  } catch (error) {
    console.log("Error in saveHTMLFromImportantDates:", error);
  }
};

// Hàm lưu trữ thông tin HTML của trang web
const saveHTMLContent = async (browser, conference, links) => {
  try {
    const linksData = {
      title: conference.Title,
      conference: conference.Acronym,
      links: links,
    };

    // Lưu file JSON vào "link-data-test"
    fs.writeFileSync(newLinksFilename, JSON.stringify(linksData, null, 2));
    console.log(`\nSaved links to: ${newLinksFilename}`);

    for (let i = 0; i < links.length; i++) {
      const page = await browser.newPage();
      // Tắt tài nguyên không cần thiết
      
      const timeout = setTimeout(() => {
        console.warn(`Page ${links[i]} is taking too long. Skipping.`);
        page.close();
      }, 60000); // 60 giây

      try {
        await page.goto(links[i], { waitUntil: "domcontentloaded" });
        clearTimeout(timeout);
    
        // Lấy nội dung HTML của trang
        const htmlContent = await page.content();

        // Kiểm tra và tạo thư mục "text-from-html-data-test" nếu chưa tồn tại
        if (!fs.existsSync("./text-from-html-data-test")) {
          fs.mkdirSync("./text-from-html-data-test");
        }

        // Lưu file txt vào thư mục "text-from-html-data-test"
        const outputFilePath = `./text-from-html-data-test/${conference.Acronym}_${i}.txt`;
        extractTextFromHTML(htmlContent, outputFilePath);
        console.log(`\nSaved text to: ${outputFilePath}`);

        // // Lấy thông tin từ các tab "Call for Paper"
        // await saveHTMLFromCallForPapers(page, conference, i);
        // await saveHTMLFromImportantDates(page, conference, i);


        await page.close();
      } catch (error) {
        console.error(`Error loading page ${links[i]}: ${error.message}`);
      } finally {
        await page.close();
      }
    }
    // } else {
    //   console.log(`File ${linksFilename} already exists. Skipping text extraction.`);
    // }
  } catch (error) {
    console.log("\nError in saveHTMLContent:", error);
  }
};

const cleanDOM = (htmlContent) => {
  const dom = new JSDOM(htmlContent);
  const document = dom.window.document;

  // Loại bỏ tất cả các thẻ <script> và <style>
  const scripts = document.querySelectorAll('script');
  scripts.forEach(script => script.remove());

  const styles = document.querySelectorAll('style');
  styles.forEach(style => style.remove());

  return document;
};

const normalizeTextNode = (text) => {
  // Loại bỏ dấu xuống dòng không cần thiết giữa các từ mà không có dấu câu
  text = text.replace(/([a-zA-Z0-9]),?\n\s*([a-zA-Z0-9])/g, '$1 $2');

  // Loại bỏ dấu xuống dòng không có dấu ngắt câu phía trước (dấu chấm, dấu chấm hỏi, dấu chấm than)
  text = text.replace(/([^\.\?\!])\n\s*/g, '$1 ');

  // Chuẩn hóa khoảng trắng dư thừa
  text = text.replace(/\s+/g, ' ');

  return text.trim();
};

// Hàm xử lý bảng (table)
const processTable = (table) => {
  let tableText = '';
  const rows = table.querySelectorAll('tr');
  if (rows.length === 0) return tableText;

  rows.forEach((row, rowIndex) => {
    const cells = row.querySelectorAll('td, th');
    if (rowIndex === 0) {
      tableText += ' \n '; // Thêm dòng mới trước dòng đầu tiên
    }

    let rowText = '';
    cells.forEach((cell, index) => {
      const cellText = traverseNodes(cell).trim(); // Gọi hàm traverseNodes để duyệt qua các thẻ con trong td/th
      if (cellText) { // Chỉ xử lý khi có nội dung trong thẻ td/th
        if (index === cells.length - 1) {
          rowText += cellText; // Không thêm dấu ngăn cách cho ô cuối cùng
        } else {
          rowText += cellText + ' | '; // Thêm dấu ngăn cách giữa các ô
        }
      }
    });

    if (rowText.trim()) { // Chỉ thêm dòng nếu có nội dung
      tableText += rowText + ' \n '; // Thêm dấu xuống dòng sau mỗi hàng
    }
  });

  return tableText + ' \n '; // Ngăn cách giữa các bảng
};

// Hàm xử lý danh sách ul/ol
const processList = (list) => {
  let listText = '';
  list.querySelectorAll('li').forEach(li => {
    const liText = traverseNodes(li).trim();
    if (liText) { // Chỉ xử lý khi có nội dung trong thẻ li
      listText += liText + " \n "; 
    }
  });
  return listText + ' \n ';
};

// Hàm đệ quy để duyệt qua các phần tử và xử lý chúng
const traverseNodes = (node) => {
  let text = '';

  if (node.nodeType === 3) { // Text node
    const trimmedText = normalizeTextNode(node.textContent.trim());
    if (trimmedText) {
      text += trimmedText + ' ';
    }
  } else if (node.nodeType === 1) { // Element node
    const tagName = node.tagName.toLowerCase();

    if (tagName === 'table') {
      text += processTable(node);
    } else if (tagName === 'li') {
      const childrenText = [];

      node.childNodes.forEach(child => {
        const childText = traverseNodes(child).trim();
        if (childText) { // Chỉ xử lý khi có nội dung trong thẻ con
          childrenText.push(childText); // Lưu lại các thẻ con của <li>
        }
      });

      if (childrenText.length > 0) {
        text += childrenText.join(' | ') + ' \n '; // Ngăn cách giữa các thẻ con bằng "|"
      }
    } else if (tagName === 'br') {
      text += ' \n '; // Thêm dấu xuống dòng khi gặp thẻ <br>
    } else {
      node.childNodes.forEach(child => {
        text += traverseNodes(child); // Đệ quy xử lý các phần tử con
      });

      // Nếu là <ul> hoặc <ol>, chỉ xử lý khi không có <li> đã được xử lý
      if (tagName === 'ul' || tagName === 'ol') {
        const liElements = node.querySelectorAll('li');
        if (liElements.length === 0) {
          text += processList(node); // Xử lý danh sách nếu không có thẻ <li>
        }
      }
    }

    // Kiểm tra block-level tags và xử lý xuống dòng
    const blockLevelTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'section', 'article', 'header', 'footer', 'aside', 'nav', 'main'];

    if (!blockLevelTags.includes(tagName) && tagName !== 'table' && tagName !== 'ul' && tagName !== 'ol') {
      text += ' '; // Thêm dấu cách nếu không phải block-level hoặc bảng
    }

    if (blockLevelTags.includes(tagName) || (tagName === 'div' && node.closest('li') === null)) {
      text += ' \n '; // Xuống dòng cho các thẻ block-level
    }
  }

  return text;
};
// Hàm để loại bỏ các hàng trống liên tiếp
const removeExtraEmptyLines = (text) => {
  return text.replace(/\n\s*\n\s*\n/g, '\n\n');
};

const extractTextFromHTML = (htmlContent, txtFilename) => {
  try {
    const document = cleanDOM(htmlContent);

    let fullText = traverseNodes(document.body);

    fullText = removeExtraEmptyLines(fullText);

    // Lưu văn bản trích xuất vào file .txt
    fs.writeFileSync(txtFilename, fullText.trim());
    console.log(`Saved extracted text to: ${txtFilename}`);
  } catch (error) {
    console.log("Error in extractTextFromHTML:", error);
  }
};

// Hàm lấy tổng số trang
const getTotalPages = async (browserContext, url) => {
  const page = await browserContext.newPage();
  await page.goto(url);

  const totalPages = await page.locator("#search > a").evaluateAll((elements) => {
    let maxPage = 1;
    elements.forEach((el) => {
      const pageValue = parseInt(el.textContent.trim(), 10);
      if (!isNaN(pageValue)) maxPage = Math.max(maxPage, pageValue);
    });
    return maxPage;
  });

  await page.close();
  return totalPages;
};

// Hàm lấy dữ liệu hội nghị từ một trang của ICORE Conference Portal
const getConferencesOnPage = async (browserContext, url) => {
  const page = await browserContext.newPage();
  await page.goto(url);

  const data = await page.$$eval("#search > table tr td", (tds) =>
    tds.map((td) => td.innerText)
  );

  const conferences = [];
  for (let i = 0; i < data.length; i += 9) {
    conferences.push({
      Title: data[i],
      Acronym: data[i + 1],
      Source: data[i + 2],
      Rank: data[i + 3],
      Note: data[i + 4],
      DBLP: data[i + 5],
      PrimaryFoR: data[i + 6],
      Comments: data[i + 7],
      AverageRating: data[i + 8],
    });
  }

  await page.close();
  return conferences;
};


const main = async () => {
  const browser = await playwright.chromium.launch({ 
    executablePath: EDGE_PATH, // Sử dụng Microsoft Edge
    headless: false ,
    args: [
      '--disable-notifications',
      '--disable-geolocation',
      '--disable-extensions',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--blink-settings=imagesEnabled=false' // Tắt hình ảnh để giảm tải
      
    ]
  });
  const browserContext = await browser.newContext({
    permissions: [], // Không cho phép bất kỳ quyền nào
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  });

  // Tắt các tài nguyên không cần thiết tại cấp độ context
  await browserContext.route("**/*", (route) => {
    const request = route.request();
    const resourceType = request.resourceType();

    if (
      ["image", "media", "font", "stylesheet", "script"].includes(resourceType) ||
      request.url().includes("google-analytics") ||
      request.url().includes("ads") ||
      request.url().includes("tracking")
    ) {
      route.abort();
    } else {
      route.continue();
    }
  });

  
  try {
    console.log("Starting crawler...");
    const allConferences = await getConferenceList(browserContext);

    // Thực hiện crawling song song với giới hạn 5 tác vụ đồng thời
    const tasks = allConferences.map((conference) =>
      queue.add(async () => {
        console.log(`Crawling data for conference: ${conference.Acronym}`);
        const links = await searchConferenceLinks(browserContext, conference);
        await saveHTMLContent(browserContext, conference, links);
      })
    );

    await Promise.all(tasks);
    console.log("Crawler finished.");
  } catch (error) {
    console.error("Error during crawling:", error);
  } finally {
    await browser.close();
  }
};

( async ()=> {
  const startTime = Date.now();
  await main();
  const endTime = Date.now();
  const runTime = endTime - startTime;
  console.log(`Time: ${endTime - startTime} ms`);
  fs.writeFileSync('runtime.txt', `Execution time: ${runTime} ms`);
})()




