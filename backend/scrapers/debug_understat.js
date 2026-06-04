import axios from 'axios';
import fs from 'fs';

async function dump() {
  const url = 'https://understat.com/league/EPL/2024';
  const res = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }
  });
  fs.writeFileSync('understat_dump.html', res.data);
  console.log('Dumped HTML to understat_dump.html');
}
dump();
