import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function testHandicapFetch() {
  const apiKey = process.env.ODDS_API_KEY || '15a3236e0ba9f1ea8ca6b7d4c335510a';
  const sportKey = 'soccer_japan_j_league';
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds`;

  console.log(`[Test] Fetching odds from: ${url}`);

  try {
    const res = await axios.get(url, {
      params: {
        apiKey,
        regions: 'eu',
        markets: 'h2h,totals,spreads',
        oddsFormat: 'decimal'
      },
      timeout: 15000
    });

    const matches = res.data;
    console.log(`[Test] Successfully fetched ${matches.length} matches.`);
    
    if (matches.length > 0) {
      const firstMatch = matches[0];
      console.log(`\n⚽ Match: ${firstMatch.home_team} vs ${firstMatch.away_team} (${firstMatch.commence_time})`);
      
      const bookmaker = firstMatch.bookmakers?.[0];
      if (bookmaker) {
        console.log(`Bookmaker: ${bookmaker.title}`);
        
        const spreads = bookmaker.markets.find(m => m.key === 'spreads');
        if (spreads) {
          console.log(`Spread market outcomes:`, JSON.stringify(spreads.outcomes, null, 2));
          
          const homeOutcome = spreads.outcomes.find(o => o.name === firstMatch.home_team);
          const awayOutcome = spreads.outcomes.find(o => o.name === firstMatch.away_team);
          if (homeOutcome && awayOutcome) {
            const pointHome = parseFloat(homeOutcome.point);
            const priceHome = parseFloat(homeOutcome.price);
            const priceAway = parseFloat(awayOutcome.price);
            console.log(`-> Home Handcap point: ${pointHome}`);
            console.log(`-> Price Home: ${priceHome} | Price Away: ${priceAway}`);
            
            const pH = 1 / priceHome;
            const pA = 1 / priceAway;
            const overround = pH + pA;
            console.log(`-> Clean Prob Home (no margin): ${(pH / overround * 100).toFixed(2)}%`);
            console.log(`-> Clean Prob Away (no margin): ${(pA / overround * 100).toFixed(2)}%`);
          }
        } else {
          console.log(`❌ No 'spreads' market found in first bookmaker. Available markets:`, bookmaker.markets.map(m => m.key));
        }
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testHandicapFetch();
