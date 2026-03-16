const fetch = require('node-fetch');
async function test() {
  const headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'};
  const url = 'https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=id:10168346';
  let r = await fetch(url, {headers});
  let text = await r.text();
  console.log('Single length:', text.length, r.status);
}
test();
