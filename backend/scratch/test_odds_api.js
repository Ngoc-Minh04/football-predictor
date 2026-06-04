import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function testOdds() {
  const apiKey = '15a3236e0ba9f1ea8ca6b7d4c335510a';
  const url = `https://api.the-odds-api.com/v4/sports/soccer_epl/odds`;

  try {
    const res = await axios.get(url, {
      params: {
        apiKey,
        regions: 'eu',
        markets: 'h2h,totals,correct_score',
        oddsFormat: 'decimal'
      },
      timeout: 15000
    });

    const matches = res.data;
    console.log(`Successfully fetched ${matches.length} matches.`);
    if (matches.length > 0) {
      const firstMatch = matches[0];
      console.log(`Match: ${firstMatch.home_team} vs ${firstMatch.away_team}`);
      console.log(`Available markets:`, firstMatch.bookmakers?.[0]?.markets?.map(m => m.key));
      const csMarket = firstMatch.bookmakers?.[0]?.markets?.find(m => m.key === 'correct_score');
      if (csMarket) {
        console.log(`Correct score outcomes (first 5):`, csMarket.outcomes.slice(0, 5));
      } else {
        console.log('No correct_score market found in first bookmaker.');
      }
    }
  } catch (err) {
    console.error('Error fetching odds:', err.message);
    if (err.response) {
      console.error('API Error Response:', err.response.data);
    }
  }
}

testOdds();
