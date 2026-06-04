import axios from 'axios';

async function testUnderstat() {
  const url = `https://understat.com/getLeagueData/EPL/2024`;
  try {
    const res = await axios.get(url, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0'
      }
    });
    const teams = res.data.teams;
    const firstTeamKey = Object.keys(teams)[0];
    const firstTeam = teams[firstTeamKey];
    console.log(`Team: ${firstTeam.title}`);
    if (firstTeam.history && firstTeam.history.length > 0) {
      console.log(`First match history record:`, firstTeam.history[0]);
    }
  } catch (err) {
    console.error('Error fetching understat:', err.message);
  }
}

testUnderstat();
