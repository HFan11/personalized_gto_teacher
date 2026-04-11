//
// TexasSolver HTTP API Server — headless, no Qt
// Exposes /api/solve endpoint for GTO strategy computation
//

#include <iostream>
#include <string>
#include <chrono>
#include "include/httplib.h"
#include "include/json.hpp"
#include "include/tools/CommandLineTool.h"

using json = nlohmann::json;
using namespace std;

int main(int argc, char* argv[]) {
    string resource_dir = "./resources";
    int port = 8080;

    // Railway sets PORT env var
    const char* env_port = getenv("PORT");
    if (env_port) port = stoi(env_port);

    // Parse args (override env)
    for (int i = 1; i < argc; i++) {
        string arg = argv[i];
        if (arg == "--port" && i + 1 < argc) port = stoi(argv[++i]);
        if (arg == "--resources" && i + 1 < argc) resource_dir = argv[++i];
    }

    cout << "TexasSolver API starting on port " << port << endl;
    cout << "Resources: " << resource_dir << endl;

    httplib::Server svr;

    // Health check
    svr.Get("/health", [](const httplib::Request&, httplib::Response& res) {
        res.set_content("{\"status\":\"ok\"}", "application/json");
    });

    // CORS preflight
    svr.Options("/api/solve", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        res.status = 204;
    });

    // Debug: test solver init on startup
    cout << "Testing PokerSolver init..." << endl;
    try {
        string test_ranks = "2,3,4,5,6,7,8,9,T,J,Q,K,A";
        string test_suits = "c,d,h,s";
        string test_cf = resource_dir + "/compairer/card5_dic_sorted.txt";
        string test_cfb = resource_dir + "/compairer/card5_dic_zipped.bin";
        PokerSolver test_ps(test_ranks, test_suits, test_cf, 2598961, test_cfb);
        cout << "PokerSolver init OK!" << endl;
    } catch (const exception& e) {
        cerr << "PokerSolver init FAILED: " << e.what() << endl;
    } catch (...) {
        cerr << "PokerSolver init FAILED: unknown exception" << endl;
    }

    // Main solve endpoint
    svr.Post("/api/solve", [&resource_dir](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");

        auto t_start = chrono::high_resolution_clock::now();

        try {
            auto body = json::parse(req.body);

            // Required parameters
            string range_ip = body.value("range_ip", "");
            string range_oop = body.value("range_oop", "");
            string board = body.value("board", "");

            if (range_ip.empty() || range_oop.empty()) {
                res.status = 400;
                res.set_content("{\"error\":\"range_ip and range_oop required\"}", "application/json");
                return;
            }

            // Game parameters
            float oop_commit = body.value("oop_commit", 3.0f);
            float ip_commit = body.value("ip_commit", 3.0f);
            int current_round = body.value("round", 1); // 0=pre,1=flop,2=turn,3=river
            int raise_limit = body.value("raise_limit", 4);
            float small_blind = body.value("small_blind", 0.5f);
            float big_blind = body.value("big_blind", 1.0f);
            float stack = body.value("stack", 100.0f);
            float allin_threshold = body.value("allin_threshold", 0.67f);

            // Solver parameters
            int iterations = body.value("iterations", 300);
            float accuracy = body.value("accuracy", 0.3f);
            int threads = body.value("threads", 8);
            string algorithm = body.value("algorithm", "discounted_cfr");
            bool use_isomorphism = body.value("use_isomorphism", true);
            int dump_depth = body.value("dump_depth", 2);

            // Bet sizes (defaults: 33%, 66%, 100% pot)
            vector<float> ip_flop_bet = body.value("ip_flop_bet", vector<float>{33, 66, 100});
            vector<float> ip_flop_raise = body.value("ip_flop_raise", vector<float>{60, 100});
            vector<float> ip_turn_bet = body.value("ip_turn_bet", vector<float>{33, 66, 100});
            vector<float> ip_turn_raise = body.value("ip_turn_raise", vector<float>{60, 100});
            vector<float> ip_river_bet = body.value("ip_river_bet", vector<float>{33, 66, 100});
            vector<float> ip_river_raise = body.value("ip_river_raise", vector<float>{60, 100});

            vector<float> oop_flop_bet = body.value("oop_flop_bet", vector<float>{33, 66, 100});
            vector<float> oop_flop_raise = body.value("oop_flop_raise", vector<float>{60, 100});
            vector<float> oop_turn_bet = body.value("oop_turn_bet", vector<float>{33, 66, 100});
            vector<float> oop_turn_raise = body.value("oop_turn_raise", vector<float>{60, 100});
            vector<float> oop_river_bet = body.value("oop_river_bet", vector<float>{33, 66, 100});
            vector<float> oop_river_raise = body.value("oop_river_raise", vector<float>{60, 100});

            bool allin = body.value("allin", true);

            // Build solver
            string suits = "c,d,h,s";
            string ranks = "2,3,4,5,6,7,8,9,T,J,Q,K,A";
            string compairer_file = resource_dir + "/compairer/card5_dic_sorted.txt";
            string compairer_file_bin = resource_dir + "/compairer/card5_dic_zipped.bin";
            int lines = 2598961;

            cout << "Creating PokerSolver with resources from: " << resource_dir << endl;
            cout << "Range IP: " << range_ip.substr(0, 50) << endl;
            cout << "Range OOP: " << range_oop.substr(0, 50) << endl;
            cout << "Board: " << board << " Round: " << current_round << endl;

            PokerSolver ps(ranks, suits, compairer_file, lines, compairer_file_bin);
            cout << "PokerSolver created OK" << endl;

            // Street settings
            StreetSetting flop_ip(ip_flop_bet, ip_flop_raise, {}, allin);
            StreetSetting turn_ip(ip_turn_bet, ip_turn_raise, {}, allin);
            StreetSetting river_ip(ip_river_bet, ip_river_raise, {}, allin);
            StreetSetting flop_oop(oop_flop_bet, oop_flop_raise, {}, allin);
            StreetSetting turn_oop(oop_turn_bet, oop_turn_raise, {}, allin);
            StreetSetting river_oop(oop_river_bet, oop_river_raise, {}, allin);

            GameTreeBuildingSettings gtbs(flop_ip, turn_ip, river_ip, flop_oop, turn_oop, river_oop);

            // Build game tree
            cout << "Building game tree..." << endl;
            ps.build_game_tree(oop_commit, ip_commit, current_round, raise_limit,
                             small_blind, big_blind, stack, gtbs, allin_threshold);
            cout << "Game tree built OK" << endl;

            // Train (solve)
            cout << "Starting train with " << iterations << " iterations, algo: " << algorithm << endl;
            string logfile = "";
            ps.train(range_ip, range_oop, board, logfile,
                    iterations, 50, algorithm, 0, accuracy,
                    use_isomorphism, 0, threads);
            cout << "Training complete" << endl;

            // Get strategy as JSON
            auto solver = ps.get_solver();
            cout << "Dumping strategy..." << endl;
            json strategy_json = solver->dumps(false, dump_depth);
            cout << "Strategy dumped, keys: " << strategy_json.size() << endl;

            auto t_end = chrono::high_resolution_clock::now();
            double solve_ms = chrono::duration<double, milli>(t_end - t_start).count();

            json response;
            response["status"] = "ok";
            response["solve_time_ms"] = solve_ms;
            response["iterations"] = iterations;
            response["strategy"] = strategy_json;

            res.set_content(response.dump(), "application/json");

        } catch (const exception& e) {
            string err_msg = e.what();
            if (err_msg.empty()) err_msg = "Unknown exception during solve";
            cerr << "Solver error: " << err_msg << endl;
            json error_resp;
            error_resp["error"] = err_msg;
            res.status = 500;
            res.set_content(error_resp.dump(), "application/json");
        } catch (...) {
            cerr << "Unknown non-std exception during solve" << endl;
            json error_resp;
            error_resp["error"] = "Internal solver crash";
            res.status = 500;
            res.set_content(error_resp.dump(), "application/json");
        }
    });

    cout << "Server ready at http://0.0.0.0:" << port << endl;
    svr.listen("0.0.0.0", port);
    return 0;
}
// Railway Pro rebuild Sat Apr 11 05:57:10 PDT 2026
