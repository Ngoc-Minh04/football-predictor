import { getDixonColesStrengths } from '../utils/dixonColesSolver.js';

async function testDC() {
  try {
    const res = await getDixonColesStrengths('PL', 2024, '2024-12-01');
    console.log('Dixon-Coles result:', res);
    if (res && res.strengths) {
      console.log('Number of teams:', Object.keys(res.strengths).length);
      console.log('Sample team strength (ID 66):', res.strengths[66]);
    }
  } catch (err) {
    console.error('Error running testDC:', err);
  }
}

testDC();
