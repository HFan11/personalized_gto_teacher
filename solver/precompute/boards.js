// ============================================================
// Generate representative flop boards for pre-computation
// Covers ~200 strategically distinct flop textures
// ============================================================

const RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];

// Board categories with representative boards
// Each board uses suit isomorphism: r=rainbow(3 suits), ss=two-tone, mono=monotone
const FLOP_BOARDS = [];

function add(cards, category) {
    FLOP_BOARDS.push({ board: cards, category });
}

// === A-HIGH BOARDS (most common) ===
// Dry
add('As,7d,2c', 'A-high dry rainbow');
add('Ad,8c,3s', 'A-high dry rainbow');
add('Ac,9d,4s', 'A-high dry rainbow');
add('As,6d,2c', 'A-high dry rainbow low');
add('Ad,5c,3s', 'A-high dry rainbow low');

// Two-tone
add('As,7s,2d', 'A-high two-tone');
add('Ad,8d,3c', 'A-high two-tone');
add('Ah,Td,5h', 'A-high two-tone T');
add('As,Js,4d', 'A-high two-tone J');

// Connected
add('As,Kd,Qc', 'AKQ broadway');
add('Ad,Kc,Js', 'AKJ broadway');
add('As,Qd,Jc', 'AQJ broadway');
add('Ad,Kc,Ts', 'AKT connected');
add('As,Td,9c', 'AT9 connected');

// Monotone
add('As,7s,2s', 'A-high monotone');
add('Ah,Th,5h', 'A-high monotone T');

// === K-HIGH BOARDS ===
add('Ks,8d,3c', 'K-high dry');
add('Kd,7c,2s', 'K-high dry low');
add('Ks,Qd,5c', 'KQ high');
add('Kd,Jc,4s', 'KJ high');
add('Ks,Td,6c', 'KT high');
add('Kd,9c,3s', 'K9 high');
add('Ks,8s,3d', 'K-high two-tone');
add('Kh,Qh,7d', 'KQ two-tone');
add('Ks,Jd,Ts', 'KJT connected two-tone');
add('Kh,Qh,Jd', 'KQJ broadway');

// === Q-HIGH BOARDS ===
add('Qs,7d,2c', 'Q-high dry');
add('Qd,8c,3s', 'Q-high dry');
add('Qs,Jd,4c', 'QJ high');
add('Qd,Tc,5s', 'QT high');
add('Qs,9d,3c', 'Q9 high');
add('Qd,Jc,Ts', 'QJT connected');
add('Qh,Jh,5d', 'QJ two-tone');
add('Qs,Ts,6d', 'QT two-tone');

// === J-HIGH BOARDS ===
add('Js,7d,2c', 'J-high dry');
add('Jd,5c,2s', 'J-high dry low');
add('Js,Td,4c', 'JT high');
add('Jd,9c,3s', 'J9 high');
add('Js,8d,5c', 'J85');
add('Jh,Th,4d', 'JT two-tone');
add('Js,Td,9c', 'JT9 connected');
add('Jd,Tc,8s', 'JT8 connected');

// === T-HIGH AND BELOW ===
add('Ts,7d,2c', 'T-high dry');
add('Td,8c,3s', 'T-high mid');
add('Ts,9d,4c', 'T9 high');
add('Ts,9d,8c', 'T98 connected');
add('Td,8c,6s', 'T86 connected');
add('9s,7d,2c', '9-high dry');
add('9d,8c,5s', '985');
add('9s,8d,7c', '987 straight board');
add('8s,7d,2c', '8-high dry');
add('8d,6c,3s', '863');
add('8s,7d,6c', '876 straight board');
add('7s,5d,3c', '753 low');
add('7d,6c,4s', '764');
add('7s,6d,5c', '765 straight board');
add('6s,5d,3c', '653 low');
add('6d,4c,2s', '642 low');
add('5s,4d,2c', '542 low');
add('5d,3c,2s', '532 lowest');

// === PAIRED BOARDS ===
// A paired
add('As,Ad,7c', 'AA7 paired');
add('Ks,Kd,5c', 'KK5 paired');
add('Qs,Qd,8c', 'QQ8 paired');
add('Js,Jd,4c', 'JJ4 paired');
add('Ts,Td,6c', 'TT6 paired');
add('9s,9d,3c', '993 paired');
add('8s,8d,2c', '882 paired');
add('7s,7d,4c', '774 paired');
add('6s,6d,3c', '663 paired');
add('5s,5d,2c', '552 paired');

// Non-top paired
add('As,7d,7c', 'A77 paired bottom');
add('Ks,8d,8c', 'K88 paired bottom');
add('Qs,5d,5c', 'Q55 paired bottom');
add('Js,3d,3c', 'J33 paired bottom');
add('As,Kd,Kc', 'AKK paired');
add('Ks,Qd,Qc', 'KQQ paired');
add('As,Td,Tc', 'ATT paired');

// === MONOTONE BOARDS ===
add('Ks,9s,4s', 'K-high monotone');
add('Qs,7s,3s', 'Q-high monotone');
add('Js,8s,2s', 'J-high monotone');
add('Ts,7s,3s', 'T-high monotone');
add('9h,6h,2h', '9-high monotone');
add('8h,5h,3h', '8-high monotone');

// === TWO-TONE SPECIAL ===
add('9s,8s,5d', '985 two-tone connected');
add('8s,7s,4d', '874 two-tone connected');
add('7s,6s,3d', '763 two-tone connected');
add('Ts,9s,7d', 'T97 two-tone');
add('Jd,9d,7s', 'J97 two-tone');

// === EXTRA: HIGH CARD INTERACTION BOARDS ===
add('Ad,Kc,4s', 'AK4');
add('As,Qd,8c', 'AQ8');
add('Ad,Jc,7s', 'AJ7');
add('As,Td,3c', 'AT3');
add('Kd,Tc,8s', 'KT8');
add('Kd,9c,6s', 'K96');
add('Qs,9d,6c', 'Q96');
add('Qs,8d,4c', 'Q84');
add('Jd,7c,3s', 'J73');
add('Td,6c,2s', 'T62');

// === TRICKY BOARDS ===
add('As,5s,4d', 'A54 wheel draw two-tone');
add('Ad,4c,3s', 'A43 wheel draw');
add('Ks,Ts,5d', 'KT5 two-tone K high');
add('Qs,9s,2d', 'Q92 two-tone');
add('Js,6s,2d', 'J62 two-tone');

console.log(`Total representative flops: ${FLOP_BOARDS.length}`);

// Export
if (typeof module !== 'undefined') module.exports = { FLOP_BOARDS };
