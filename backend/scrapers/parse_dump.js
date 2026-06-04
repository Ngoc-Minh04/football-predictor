import fs from 'fs';
import * as cheerio from 'cheerio';

const html = fs.readFileSync('understat_2024.html', 'utf8');
const $ = cheerio.load(html);
$('script').each((i, el) => {
  const text = $(el).html();
  if (text && text.includes('2024')) {
    console.log('Script ' + i + ' length:', text.length);
    fs.writeFileSync(`script_${i}.txt`, text);
  }
});
