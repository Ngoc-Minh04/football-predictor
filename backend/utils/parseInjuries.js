import { toViName } from './teamTranslator.js';

const INJURY_KEYWORDS = [
  'injured', 'injury', 'suspended', 'suspension', 'unavailable', 'out', 'doubt', 'doubtful',
  'miss', 'missing', 'fitness', 'hamstring', 'knee', 'ankle', 'muscle', 'strain', 'fracture',
  // Vietnamese
  'chấn thương', 'treo giò', 'vắng mặt', 'nghi ngờ', 'cấm thi đấu', 'nghỉ', 'không thi đấu',
];

const PENALTY_PER_PLAYER = 0.06; // 6% default penalty per normal player
const MAX_PENALTY = 0.45;        // max 45% total reduction (increased from 25% to allow for key player cumulative loss)

// Key players database with estimated G+A contributions
const KEY_PLAYERS_MAP = {
  "Liverpool FC": {
    "Salah": 0.35,
    "Diaz": 0.15,
    "Jota": 0.12,
    "Nunez": 0.10,
    "Gakpo": 0.10,
  },
  "Manchester City FC": {
    "Haaland": 0.40,
    "De Bruyne": 0.20,
    "Foden": 0.18,
    "Silva": 0.10,
    "Alvarez": 0.12,
  },
  "Arsenal FC": {
    "Saka": 0.30,
    "Odegaard": 0.18,
    "Havertz": 0.15,
    "Martinelli": 0.10,
    "Trossard": 0.12,
  },
  "Chelsea FC": {
    "Palmer": 0.45,
    "Jackson": 0.15,
    "Madueke": 0.10,
    "Nkunku": 0.12,
  },
  "Manchester United FC": {
    "Fernandes": 0.25,
    "Rashford": 0.18,
    "Hojlund": 0.15,
    "Garnacho": 0.12,
  },
  "Tottenham Hotspur FC": {
    "Son": 0.30,
    "Richarlison": 0.15,
    "Kulusevski": 0.12,
    "Maddison": 0.15,
  },
  "Aston Villa FC": {
    "Watkins": 0.35,
    "Bailey": 0.15,
    "McGinn": 0.10,
    "Diaby": 0.12,
  },
  "Newcastle United FC": {
    "Isak": 0.35,
    "Gordon": 0.18,
    "Barnes": 0.10,
    "Guimaraes": 0.10,
  },
  // Đội tuyển quốc gia tại World Cup 2026
  "Argentina": {
    "Messi": 0.40,
    "Lautaro": 0.20,
    "Alvarez": 0.15,
    "Di Maria": 0.15,
    "Fernandez": 0.10,
    "Mac Allister": 0.10,
  },
  "France": {
    "Mbappe": 0.40,
    "Griezmann": 0.20,
    "Dembele": 0.15,
    "Giroud": 0.12,
    "Kolo Muani": 0.10,
    "Thuram": 0.12,
  },
  "England": {
    "Kane": 0.40,
    "Bellingham": 0.25,
    "Saka": 0.25,
    "Foden": 0.20,
    "Palmer": 0.20,
    "Rashford": 0.12,
  },
  "Brazil": {
    "Vinicius": 0.35,
    "Neymar": 0.35,
    "Rodrygo": 0.18,
    "Richarlison": 0.15,
    "Martinelli": 0.12,
    "Raphinha": 0.15,
  },
  "Portugal": {
    "Ronaldo": 0.25,
    "Fernandes": 0.25,
    "Silva": 0.18,
    "Leao": 0.15,
    "Felix": 0.12,
    "Jota": 0.12,
  },
  "Spain": {
    "Yamal": 0.30,
    "Morata": 0.20,
    "Olmo": 0.20,
    "Williams": 0.20,
    "Torres": 0.12,
    "Oyarzabal": 0.12,
  },
  "Germany": {
    "Musiala": 0.25,
    "Wirtz": 0.25,
    "Havertz": 0.20,
    "Fullkrug": 0.18,
    "Sane": 0.15,
    "Gnabry": 0.12,
  },
  "Netherlands": {
    "Depay": 0.25,
    "Gakpo": 0.25,
    "Simons": 0.18,
    "De Jong": 0.15,
    "Van Dijk": 0.15,
  },
  "Italy": {
    "Chiesa": 0.22,
    "Barella": 0.15,
    "Scamacca": 0.20,
    "Retegui": 0.18,
    "Donnarumma": 0.15,
  },
  "Belgium": {
    "De Bruyne": 0.25,
    "Lukaku": 0.35,
    "Doku": 0.18,
    "Trossard": 0.15,
  },
  "Uruguay": {
    "Nunez": 0.35,
    "Suarez": 0.20,
    "Valverde": 0.15,
    "Araujo": 0.15,
  },
  "Croatia": {
    "Modric": 0.20,
    "Kramaric": 0.25,
    "Kovacic": 0.12,
    "Perisic": 0.15,
  },
  "Japan": {
    "Mitoma": 0.25,
    "Kubo": 0.22,
    "Endo": 0.12,
    "Minamino": 0.18,
  },
  "USA": {
    "Pulisic": 0.35,
    "Balogun": 0.20,
    "Weah": 0.15,
    "McKennie": 0.12,
  },
  "Mexico": {
    "Gimenez": 0.30,
    "Lozano": 0.22,
    "Alvarez": 0.15,
    "Martin": 0.15,
  },
  "Colombia": {
    "Diaz": 0.25,
    "Rodriguez": 0.22,
    "Borre": 0.15,
    "Arias": 0.12,
  },
  "Morocco": {
    "Ziyech": 0.25,
    "En-Nesyri": 0.25,
    "Hakimi": 0.18,
    "Diaz": 0.15,
    "Amrabat": 0.10,
  },
  "Senegal": {
    "Mane": 0.35,
    "Jackson": 0.20,
    "Sarr": 0.15,
    "Koulibaly": 0.15,
  },
  "Denmark": {
    "Hojlund": 0.30,
    "Eriksen": 0.22,
    "Wind": 0.15,
    "Christensen": 0.15,
  },
  "Switzerland": {
    "Embolo": 0.25,
    "Xhaka": 0.20,
    "Shaqiri": 0.18,
    "Akanji": 0.15,
  },
  "South Korea": {
    "Son": 0.40,
    "Hwang": 0.20,
    "Lee": 0.18,
    "Cho": 0.15,
  },
  "Canada": {
    "David": 0.30,
    "Davies": 0.25,
    "Larin": 0.18,
    "Buchanan": 0.15,
  },
  "Ecuador": {
    "Valencia": 0.30,
    "Caicedo": 0.18,
    "Estupinan": 0.15,
    "Rodriguez": 0.15,
  },
  "Ukraine": {
    "Dovbyk": 0.30,
    "Mudryk": 0.20,
    "Tsygankov": 0.18,
    "Zinchenko": 0.15,
  },
  "Poland": {
    "Lewandowski": 0.40,
    "Zielinski": 0.20,
    "Swiderski": 0.15,
    "Szczesny": 0.15,
  },
  "Turkey": {
    "Yilmaz": 0.25,
    "Guler": 0.22,
    "Calhanoglu": 0.20,
    "Akturkoglu": 0.18,
  },
  "Austria": {
    "Sabitzer": 0.25,
    "Gregoritsch": 0.20,
    "Laimer": 0.15,
    "Baumgartner": 0.18,
  },
  "Sweden": {
    "Gyokeres": 0.35,
    "Isak": 0.30,
    "Kulusevski": 0.18,
    "Elanga": 0.15,
  },
  "Nigeria": {
    "Osimhen": 0.35,
    "Lookman": 0.25,
    "Boniface": 0.20,
    "Iwobi": 0.12,
  },
  "Ivory Coast": {
    "Haller": 0.28,
    "Adingra": 0.20,
    "Kessie": 0.18,
    "Singo": 0.12,
  },
  "Algeria": {
    "Mahrez": 0.28,
    "Bounedjah": 0.20,
    "Bennacer": 0.15,
    "Aouar": 0.15,
  },
  "Egypt": {
    "Salah": 0.45,
    "Marmoush": 0.22,
    "Mostafa": 0.18,
    "Trezeguet": 0.15,
  },
  "Saudi Arabia": {
    "Al-Dawsari": 0.30,
    "Al-Shehri": 0.20,
    "Al-Buraikan": 0.18,
  },
  "Australia": {
    "Duke": 0.20,
    "Boyle": 0.18,
    "Goodwin": 0.18,
    "Irvine": 0.15,
  },
  "Cameroon": {
    "Aboubakar": 0.28,
    "Toko Ekambi": 0.18,
    "Mbeumo": 0.22,
    "Anguissa": 0.15,
  }
};

function hasInjury(clause) {
  const lower = clause.toLowerCase();
  return INJURY_KEYWORDS.some(kw => lower.includes(kw));
}

function splitTeamSections(text, homeName, awayName) {
  const pipeIdx = text.indexOf('|');
  if (pipeIdx > -1) {
    return {
      homeText: text.substring(0, pipeIdx),
      awayText: text.substring(pipeIdx + 1),
    };
  }

  const lowerText = text.toLowerCase();
  
  // Try to find home prefix
  let homeIdx = lowerText.indexOf(toViName(homeName).toLowerCase() + ':');
  if (homeIdx === -1) homeIdx = lowerText.indexOf(homeName.toLowerCase() + ':');
  if (homeIdx === -1) homeIdx = lowerText.indexOf(homeName.split(' ')[0].toLowerCase() + ':');
  if (homeIdx === -1) homeIdx = lowerText.indexOf(toViName(homeName).split(' ')[0].toLowerCase() + ':');

  // Try to find away prefix
  let awayIdx = lowerText.indexOf(toViName(awayName).toLowerCase() + ':');
  if (awayIdx === -1) awayIdx = lowerText.indexOf(awayName.toLowerCase() + ':');
  if (awayIdx === -1) awayIdx = lowerText.indexOf(awayName.split(' ')[0].toLowerCase() + ':');
  if (awayIdx === -1) awayIdx = lowerText.indexOf(toViName(awayName).split(' ')[0].toLowerCase() + ':');

  if (homeIdx > -1 && awayIdx > -1) {
    if (homeIdx < awayIdx) {
      return { homeText: text.substring(homeIdx, awayIdx), awayText: text.substring(awayIdx) };
    } else {
      return { homeText: text.substring(homeIdx), awayText: text.substring(awayIdx, homeIdx) };
    }
  }

  return { homeText: text, awayText: text, ambiguous: true };
}

/**
 * Calculates injury count and total G+A penalty reduction for a team's text block
 */
function analyzeTeamAbsences(text, teamName) {
  if (!text) return { count: 0, reduction: 0 };

  // Find matched key players map
  let matchedTeamKey = null;
  const teamShort = teamName.replace(/ (FC|Club|AC|UD|Real|RC)$/i, "").toLowerCase().trim();
  const teamViShort = toViName(teamName).replace(/ (FC|Club|AC|UD|Real|RC)$/i, "").toLowerCase().trim();
  
  for (const key of Object.keys(KEY_PLAYERS_MAP)) {
    const keyShort = key.replace(" FC", "").toLowerCase().trim();
    if (teamShort.includes(keyShort) || keyShort.includes(teamShort) ||
        teamViShort.includes(keyShort) || keyShort.includes(teamViShort)) {
      matchedTeamKey = key;
      break;
    }
  }

  const clauses = text.split(/[,;\n]/);
  let totalReduction = 0;
  let count = 0;

  for (const clause of clauses) {
    if (!clause.trim() || !hasInjury(clause)) continue;

    let playerWeight = PENALTY_PER_PLAYER; // default
    if (matchedTeamKey) {
      const players = KEY_PLAYERS_MAP[matchedTeamKey];
      for (const [playerName, gaWeight] of Object.entries(players)) {
        // match word bounds or simple substring search for player name
        const regex = new RegExp(`\\b${playerName}\\b`, 'i');
        if (regex.test(clause)) {
          playerWeight = gaWeight;
          console.log(`[parseInjuries] Phát hiện thiếu vắng cầu thủ chủ chốt: ${playerName} (${teamName}) -> Hệ số phạt: -${Math.round(gaWeight * 100)}%`);
          break;
        }
      }
    }

    totalReduction += playerWeight;
    count++;
  }

  return { count, reduction: totalReduction };
}

/**
 * Parse the injuries string and return lambda reductions per team
 */
export function parseInjuries(injuriesText, homeTeamName = '', awayTeamName = '') {
  if (!injuriesText || injuriesText.trim() === '' || injuriesText.trim() === '-') {
    return { homeReduction: 0, awayReduction: 0 };
  }

  const { homeText, awayText, ambiguous } = splitTeamSections(injuriesText, homeTeamName, awayTeamName);

  if (ambiguous) {
    // If ambiguous, count total and split equally with average penalty
    const homeAbs = analyzeTeamAbsences(homeText, homeTeamName);
    const awayAbs = analyzeTeamAbsences(awayText, awayTeamName);
    const avgReduction = Math.min(MAX_PENALTY, (homeAbs.reduction + awayAbs.reduction) / 2);
    return {
      homeReduction: avgReduction,
      awayReduction: avgReduction,
    };
  }

  const homeAbs = analyzeTeamAbsences(homeText, homeTeamName);
  const awayAbs = analyzeTeamAbsences(awayText, awayTeamName);

  return {
    homeReduction: Math.min(MAX_PENALTY, homeAbs.reduction),
    awayReduction: Math.min(MAX_PENALTY, awayAbs.reduction),
  };
}
