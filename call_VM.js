import  axios from 'axios';

axios.post('http://20.198.244.84:3000/run-crawl')
    .then(response => {
        console.log('Response:', response.data);
    })
    .catch(error => {
        console.error('Error:', error.message);
    });
