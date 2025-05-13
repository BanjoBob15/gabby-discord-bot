const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Gabby is operational.');
});

function keepAlive() {
  app.listen(3000, () => {
    console.log("✅ Keep-alive server is running.");
  });
}

module.exports = keepAlive;
