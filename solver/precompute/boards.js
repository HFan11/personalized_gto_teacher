// ============================================================
// Generate representative flop boards for pre-computation
// ~310 strategically distinct flop textures
// Covers: all high-card combos × textures (dry/two-tone/monotone/connected/paired)
// ============================================================

const RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];

const FLOP_BOARDS = [];
function add(cards, category) {
    FLOP_BOARDS.push({ board: cards, category });
}

// ================================================================
// SYSTEMATIC COVERAGE: High × Mid × Low, all textures
// ================================================================

// --- A-HIGH ---
// Dry rainbow
add('As,7d,2c', 'A-high dry'); add('Ad,8c,3s', 'A-high dry'); add('Ac,9d,4s', 'A-high dry');
add('As,6d,2c', 'A-high dry low'); add('Ad,5c,3s', 'A-high dry low');
// Two-tone
add('As,7s,2d', 'A-high tt'); add('Ad,8d,3c', 'A-high tt'); add('Ah,Td,5h', 'A-high tt T');
add('As,Js,4d', 'A-high tt J'); add('Ah,9h,3d', 'A-high tt 9');
// Connected / Broadway
add('As,Kd,Qc', 'AKQ bway'); add('Ad,Kc,Js', 'AKJ bway'); add('As,Qd,Jc', 'AQJ bway');
add('Ad,Kc,Ts', 'AKT conn'); add('As,Td,9c', 'AT9 conn'); add('Ad,Qc,Ts', 'AQT');
add('As,Kd,9c', 'AK9'); add('Ad,Jc,Ts', 'AJT conn'); add('As,Kd,5c', 'AK5');
// Connected two-tone
add('As,Ks,Qd', 'AKQ tt'); add('Ad,Qd,Jc', 'AQJ tt'); add('As,Ks,Td', 'AKT tt');
add('As,Ts,9d', 'AT9 tt');
// Monotone
add('As,7s,2s', 'A-high mono'); add('Ah,Th,5h', 'A-high mono T'); add('As,Ks,Qs', 'AKQ mono');

// --- K-HIGH ---
add('Ks,8d,3c', 'K-high dry'); add('Kd,7c,2s', 'K-high dry low'); add('Ks,6d,2c', 'K62 dry');
add('Ks,Qd,5c', 'KQ5'); add('Kd,Jc,4s', 'KJ4'); add('Ks,Td,6c', 'KT6'); add('Kd,9c,3s', 'K93');
add('Ks,8s,3d', 'K-high tt'); add('Kh,Qh,7d', 'KQ tt'); add('Kd,Jd,5c', 'KJ tt');
add('Ks,Jd,Ts', 'KJT conn tt'); add('Kh,Qh,Jd', 'KQJ bway');
add('Kd,Qc,Ts', 'KQT'); add('Ks,Jd,9c', 'KJ9'); add('Kd,Tc,8s', 'KT8');
add('Kd,9c,6s', 'K96'); add('Ks,Ts,6d', 'KT6 tt');
add('Ks,9s,4s', 'K-high mono'); add('Kh,Qh,9h', 'KQ9 mono');

// --- Q-HIGH ---
add('Qs,7d,2c', 'Q-high dry'); add('Qd,8c,3s', 'Q-high dry'); add('Qs,6d,2c', 'Q62 dry');
add('Qs,Jd,4c', 'QJ4'); add('Qd,Tc,5s', 'QT5'); add('Qs,9d,3c', 'Q93');
add('Qd,Jc,Ts', 'QJT conn'); add('Qs,Jd,9c', 'QJ9 conn'); add('Qd,Tc,8s', 'QT8 conn');
add('Qh,Jh,5d', 'QJ tt'); add('Qs,Ts,6d', 'QT tt'); add('Qd,9d,4c', 'Q94 tt');
add('Qs,7s,3s', 'Q-high mono'); add('Qh,Jh,Th', 'QJT mono');

// --- J-HIGH ---
add('Js,7d,2c', 'J-high dry'); add('Jd,5c,2s', 'J-high dry low'); add('Js,8d,5c', 'J85');
add('Js,Td,4c', 'JT4'); add('Jd,9c,3s', 'J93'); add('Js,8d,2c', 'J82');
add('Jh,Th,4d', 'JT tt'); add('Js,9s,3d', 'J93 tt'); add('Jd,8d,4c', 'J84 tt');
add('Js,Td,9c', 'JT9 conn'); add('Jd,Tc,8s', 'JT8 conn'); add('Js,9d,8c', 'J98 conn');
add('Js,Ts,9d', 'JT9 tt'); add('Jd,9d,7c', 'J97 tt');
add('Js,8s,2s', 'J-high mono');

// --- T-HIGH ---
add('Ts,7d,2c', 'T-high dry'); add('Td,8c,3s', 'T-high mid'); add('Ts,6d,2c', 'T62');
add('Ts,9d,4c', 'T94'); add('Ts,9d,8c', 'T98 conn'); add('Td,8c,6s', 'T86 conn');
add('Ts,9d,7c', 'T97 conn'); add('Ts,8s,4d', 'T84 tt'); add('Td,9d,5c', 'T95 tt');
add('Ts,9s,7d', 'T97 tt');
add('Ts,7s,3s', 'T-high mono');

// --- 9-HIGH AND BELOW ---
add('9s,7d,2c', '9-high dry'); add('9d,8c,5s', '985'); add('9s,6d,3c', '963');
add('9s,8d,7c', '987 str'); add('9d,8c,6s', '986 conn'); add('9s,7d,5c', '975 conn');
add('9s,8s,5d', '985 tt'); add('9h,6h,2h', '9-high mono');
add('8s,7d,2c', '8-high dry'); add('8d,6c,3s', '863'); add('8s,5d,2c', '852');
add('8s,7d,6c', '876 str'); add('8d,7c,5s', '875 conn'); add('8s,6d,4c', '864 conn');
add('8s,7s,4d', '874 tt'); add('8h,5h,3h', '8-high mono');
add('7s,5d,3c', '753'); add('7d,6c,4s', '764'); add('7s,6d,5c', '765 str');
add('7s,4d,2c', '742'); add('7s,6s,3d', '763 tt');
add('6s,5d,3c', '653'); add('6d,4c,2s', '642'); add('6s,5d,4c', '654 str');
add('5s,4d,2c', '542'); add('5d,3c,2s', '532');

// ================================================================
// PAIRED BOARDS
// ================================================================
// Top paired
add('As,Ad,7c', 'AA7'); add('As,Ad,Tc', 'AAT'); add('As,Ad,3c', 'AA3');
add('Ks,Kd,5c', 'KK5'); add('Ks,Kd,9c', 'KK9');
add('Qs,Qd,8c', 'QQ8'); add('Qs,Qd,3c', 'QQ3');
add('Js,Jd,4c', 'JJ4'); add('Js,Jd,7c', 'JJ7');
add('Ts,Td,6c', 'TT6'); add('9s,9d,3c', '993');
add('8s,8d,2c', '882'); add('7s,7d,4c', '774');
add('6s,6d,3c', '663'); add('5s,5d,2c', '552');

// Bottom/middle paired
add('As,7d,7c', 'A77'); add('Ks,8d,8c', 'K88'); add('Qs,5d,5c', 'Q55');
add('Js,3d,3c', 'J33'); add('Ts,4d,4c', 'T44'); add('9s,2d,2c', '922');
add('As,Kd,Kc', 'AKK'); add('Ks,Qd,Qc', 'KQQ'); add('As,Td,Tc', 'ATT');
add('Ks,Jd,Jc', 'KJJ'); add('Qs,Td,Tc', 'QTT');

// Paired + two-tone
add('As,Ad,7s', 'AA7 tt'); add('Ks,Kd,8s', 'KK8 tt'); add('Js,Jd,6s', 'JJ6 tt');

// ================================================================
// MONOTONE BOARDS (expanded)
// ================================================================
add('Kh,9h,4h', 'K94 mono'); add('Qh,8h,3h', 'Q83 mono');
add('Jh,7h,3h', 'J73 mono'); add('Th,6h,2h', 'T62 mono');
add('Kh,Jh,9h', 'KJ9 mono'); add('Qh,Th,8h', 'QT8 mono'); add('Jh,9h,7h', 'J97 mono');
add('Ah,Kh,8h', 'AK8 mono');

// ================================================================
// TWO-TONE CONNECTED (expanded)
// ================================================================
add('Ts,9s,6d', 'T96 tt'); add('8s,6s,3d', '863 tt'); add('7s,5s,2d', '752 tt');
add('Ks,Qs,7d', 'KQ7 tt'); add('Jh,Th,6d', 'JT6 tt'); add('9h,8h,4d', '984 tt');
add('Ah,Kh,4d', 'AK4 tt'); add('As,Qd,8s', 'AQ8 tt');

// ================================================================
// HIGH CARD INTERACTIONS
// ================================================================
add('Ad,Kc,4s', 'AK4'); add('As,Qd,8c', 'AQ8'); add('Ad,Jc,7s', 'AJ7');
add('As,Td,3c', 'AT3'); add('Qs,9d,6c', 'Q96'); add('Qs,8d,4c', 'Q84');
add('Jd,7c,3s', 'J73'); add('Td,6c,2s', 'T62');
add('Ad,Qc,4s', 'AQ4'); add('As,Jd,3c', 'AJ3'); add('Kd,Tc,4s', 'KT4');
add('Kd,8c,5s', 'K85'); add('Qd,7c,3s', 'Q73'); add('Jd,6c,2s', 'J62');

// ================================================================
// TRICKY / WHEEL / GAP BOARDS
// ================================================================
add('As,5s,4d', 'A54 wheel tt'); add('Ad,4c,3s', 'A43 wheel');
add('As,3d,2c', 'A32 wheel'); add('Ad,5c,4s', 'A54 wheel'); add('As,4d,2c', 'A42 wheel');
add('Ks,Ts,5d', 'KT5 tt'); add('Qs,9s,2d', 'Q92 tt'); add('Js,6s,2d', 'J62 tt');
add('Td,7c,4s', 'T74 gap'); add('9d,6c,3s', '963 gap'); add('8d,5c,2s', '852 gap');

// ================================================================
// EXTREME TEXTURES
// ================================================================
// Three-to-a-straight (very wet)
add('Jd,Tc,9s', 'JT9 str3'); add('Td,9c,8s', 'T98 str3');
add('9d,8c,7s', '987 str3'); add('8d,7c,6s', '876 str3');
add('7d,6c,5s', '765 str3'); add('6d,5c,4s', '654 str3'); add('5d,4c,3s', '543 str3');
add('Ad,Kc,Qs', 'AKQ str3'); add('Kd,Qc,Js', 'KQJ str3');
// Three-to-a-straight two-tone
add('Ts,9s,8d', 'T98 str3 tt'); add('9s,8s,7d', '987 str3 tt');

// ================================================================
// ADDITIONAL COVERAGE: missing gapped, mid-high combos
// ================================================================
// A-high gapped
add('As,8d,4c', 'A84 gap'); add('Ad,9c,5s', 'A95 gap'); add('As,7d,3c', 'A73 gap');
add('Ad,6c,2s', 'A62'); add('As,8d,6c', 'A86');
// K-high extra
add('Kd,7c,4s', 'K74'); add('Ks,9d,5c', 'K95'); add('Kd,Jc,8s', 'KJ8');
add('Ks,Qd,9c', 'KQ9'); add('Kd,Tc,6s', 'KT6r');
// Q-high extra
add('Qs,Jd,7c', 'QJ7'); add('Qd,Tc,9s', 'QT9'); add('Qs,8d,5c', 'Q85');
// J-high extra
add('Jd,8c,3s', 'J83'); add('Js,Td,6c', 'JT6'); add('Jd,9c,5s', 'J95');
// T-high extra
add('Ts,8d,5c', 'T85'); add('Td,9c,6s', 'T96'); add('Ts,7d,4c', 'T74r');
// Low extra
add('9d,7c,4s', '974'); add('9s,5d,2c', '952'); add('8d,7c,4s', '874');
add('8s,5d,3c', '853'); add('7d,4c,2s', '742r'); add('6s,4d,2c', '642r');
// Two-tone gapped
add('Kd,7d,3c', 'K73 tt'); add('Ad,6d,2c', 'A62 tt'); add('Qd,8d,5c', 'Q85 tt');
add('Jd,7d,2c', 'J72 tt'); add('Td,6d,2c', 'T62 tt');
// Paired extra
add('4s,4d,2c', '442'); add('3s,3d,7c', '337'); add('2s,2d,5c', '225');
add('As,9d,9c', 'A99'); add('Ks,6d,6c', 'K66'); add('Qs,4d,4c', 'Q44');
add('Js,Td,Tc', 'JTT'); add('9s,8d,8c', '988');
// Three broadway extra
add('Kd,Jc,Ts', 'KJT'); add('Qs,Kd,Tc', 'QKT');
// Wheel complete
add('As,2d,3c', 'A23 wheel');
// Extra monotone
add('7h,5h,3h', '753 mono'); add('6h,4h,2h', '642 mono');

console.log(`Total representative flops: ${FLOP_BOARDS.length}`);
if (typeof module !== 'undefined') module.exports = { FLOP_BOARDS };
