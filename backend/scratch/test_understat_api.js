import axios from 'axios';

async function testUnderstat() {
  const url = 'https://understat.com/getLeagueData/EPL/2024';
  try {
    const res = await axios.get(url, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0'
      }
    });
    if (res.data && res.data.teams) {
      const firstTeamKey = Object.keys(res.data.teams)[0];
      const team = res.data.teams[firstTeamKey];
      console.log('Team Title:', team.title);
      if (team.history && team.history.length > 0) {
        console.log('First history entry fields:', Object.keys(team.history[0]));
        console.log('First history sample match:', team.history[0]);
      }
    }
  } catch (err) {
    console.error('Error fetching Understat API:', err.message);
  }
}

testUnderstat();
