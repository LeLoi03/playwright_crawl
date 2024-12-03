const express = require('express');
const { exec } = require('child_process');
const app = express();

// Middleware để xử lý JSON
app.use(express.json());

// Endpoint để chạy file crawl
app.post('/run-crawl', (req, res) => {
    exec('node /đường/dẫn/tới/file_crawl.js', (error, stdout, stderr) => {
        if (error) {
            return res.status(500).send(`Error: ${error.message}`);
        }
        res.send(`Output: ${stdout}`);
    });
});

// Server chạy trên cổng 3000
app.listen(3000, () => {
    console.log('API Server is running on port 3000');
});
