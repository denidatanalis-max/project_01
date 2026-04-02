// ============================================================
// GET /games — Dashboard utama games
// ============================================================
function halamanGames(req, res) {
    res.render('dashboard_game', {
        title: 'games',
        user: res.locals.user
    });
}

module.exports = {
    halamanGames
};