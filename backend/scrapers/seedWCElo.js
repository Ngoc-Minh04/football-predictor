import { getDatabase, queryAll, queryRun } from '../db/database.js';

const WC_ELO_RATINGS = {
  "argentina": 2140,
  "france": 2080,
  "spain": 2060,
  "england": 2010,
  "brazil": 2020,
  "portugal": 1990,
  "netherlands": 1960,
  "belgium": 1920,
  "italy": 1940,
  "germany": 1950,
  "croatia": 1910,
  "uruguay": 1970,
  "colombia": 1980,
  "morocco": 1880,
  "japan": 1860,
  "usa": 1820,
  "united states": 1820,
  "mexico": 1780,
  "senegal": 1820,
  "south korea": 1790,
  "korea republic": 1790,
  "iran": 1810,
  "ir iran": 1810,
  "islamic republic of iran": 1810,
  "denmark": 1850,
  "switzerland": 1870,
  "austria": 1860,
  "ukraine": 1790,
  "sweden": 1800,
  "poland": 1760,
  "serbia": 1750,
  "ecuador": 1830,
  "peru": 1710,
  "chile": 1720,
  "wales": 1730,
  "hungary": 1790,
  "canada": 1750,
  "tunisia": 1700,
  "algeria": 1740,
  "egypt": 1760,
  "australia": 1770,
  "turkey": 1780,
  "czech republic": 1750,
  "romania": 1710,
  "slovakia": 1720,
  "scotland": 1700,
  "norway": 1760,
  "greece": 1720,
  "saudi arabia": 1610,
  "qatar": 1650,
  "cameroon": 1670,
  "nigeria": 1740,
  "ivory coast": 1760,
  "côte d'ivoire": 1760,
  "south africa": 1600,
  "iraq": 1620,
  "uzbekistan": 1640,
  "united arab emirates": 1560,
  "oman": 1570,
  "china": 1510,
  "china pr": 1510,
  "vietnam": 1400,
  "thailand": 1450,
  "indonesia": 1430
};

// Normalize names for fuzzy match
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/ (fc|cf|ac|ud|rc|republic|pr|ir|de)$/i, '')
    .replace(/^(republic of|islamic republic of) /i, '')
    .trim();
}

async function seedWCElo() {
  const db = await getDatabase();
  
  console.log('[Elo Seeder] Đang tải danh sách các đội tuyển quốc gia (WC/EC)...');
  
  // Lấy các đội tuyển thuộc giải World Cup hoặc Euro
  const teams = await queryAll(db, 
    `SELECT id, name, league, elo_rating 
     FROM teams 
     WHERE league LIKE '%WC%' OR league LIKE '%EC%'`
  );
  
  console.log(`[Elo Seeder] Tìm thấy ${teams.length} đội tuyển trong database.`);
  
  let updatedCount = 0;
  
  for (const team of teams) {
    const rawName = team.name;
    const normalized = normalizeName(rawName);
    
    let elo = 1600; // Mức ELO trung bình mặc định cho ĐTQG thay vì 1500
    let matched = false;
    
    // Tìm ELO khớp chính xác hoặc khớp tương đối
    for (const [key, rating] of Object.entries(WC_ELO_RATINGS)) {
      if (normalized === key || normalized.includes(key) || key.includes(normalized)) {
        elo = rating;
        matched = true;
        break;
      }
    }
    
    await queryRun(db, 
      "UPDATE teams SET elo_rating = ? WHERE id = ?",
      [elo, team.id]
    );
    
    if (matched) {
      console.log(`   ✅ Cập nhật ELO cho ${rawName.padEnd(25)} -> ${elo}`);
    } else {
      console.log(`   ⚠️  Không tìm thấy ELO cho ${rawName.padEnd(25)} -> Sử dụng mặc định: ${elo}`);
    }
    updatedCount++;
  }
  
  console.log(`\n[Elo Seeder] Hoàn thành cập nhật ELO cho ${updatedCount}/${teams.length} đội tuyển.`);
  process.exit(0);
}

seedWCElo().catch(err => {
  console.error('[Elo Seeder] Lỗi khi chạy seeder:', err);
  process.exit(1);
});
