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

    // Parse args
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
            int iterations = body.value("iterations", 200);
            float accuracy = body.value("accuracy", 0.5f);
            int threads = body.value("threads", 4);
            string algorithm = body.value("algorithm", "cfr_plus");
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

            PokerSolver ps(ranks, suits, compairer_file, lines, compairer_file_bin);

            // Street settings
            StreetSetting flop_ip(ip_flop_bet, ip_flop_raise, {}, allin);
            StreetSetting turn_ip(ip_turn_bet, ip_turn_raise, {}, allin);
            StreetSetting river_ip(ip_river_bet, ip_river_raise, {}, allin);
            StreetSetting flop_oop(oop_flop_bet, oop_flop_raise, {}, allin);
            StreetSetting turn_oop(oop_turn_bet, oop_turn_raise, {}, allin);
            StreetSetting river_oop(oop_river_bet, oop_river_raise, {}, allin);

            GameTreeBuildingSettings gtbs(flop_ip, turn_ip, river_ip, flop_oop, turn_oop, river_oop);

            // Build game tree
            ps.build_game_tree(oop_commit, ip_commit, current_round, raise_limit,
                             small_blind, big_blind, stack, gtbs, allin_threshold);

            // Train (solve)
            string logfile = "";
            ps.train(range_ip, range_oop, board, logfile,
                    iterations, 50, algorithm, 0, accuracy,
                    use_isomorphism, 0, threads);

            // Get strategy as JSON
            auto solver = ps.get_solver();
            json strategy_json = solver->dumps(true, dump_depth);

            auto t_end = chrono::high_resolution_clock::now();
            double solve_ms = chrono::duration<double, milli>(t_end - t_start).count();

            json response;
            response["status"] = "ok";
            response["solve_time_ms"] = solve_ms;
            response["iterations"] = iterations;
            response["strategy"] = strategy_json;

            res.set_content(response.dump(), "application/json");

        } catch (const exception& e) {
            json error_resp;
            error_resp["error"] = e.what();
            res.status = 500;
            res.set_content(error_resp.dump(), "application/json");
        }
    });

    cout << "Server ready at http://0.0.0.0:" << port << endl;
    svr.listen("0.0.0.0", port);
    return 0;
}
