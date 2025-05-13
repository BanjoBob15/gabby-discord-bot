import express from 'express';

function keepAlive() {
  const app = express();
  app.get('/', (req, res) => res.send('✅ Gabby is awake.'));
  app.listen(3000, () => console.log('✅ Keep-alive server is running.'));
}

export default keepAlive;
