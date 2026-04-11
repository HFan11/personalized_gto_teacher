cmake_minimum_required(VERSION 3.10)
project(TexasSolverAPI CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-O2)

# Find OpenMP (optional but recommended for performance)
find_package(OpenMP)

# Core solver library (no Qt, no GUI, no experimental)
set(SOLVER_SOURCES
    src/Card.cpp
    src/Deck.cpp
    src/GameTree.cpp
    src/nodes/ActionNode.cpp
    src/nodes/ChanceNode.cpp
    src/nodes/GameActions.cpp
    src/nodes/GameTreeNode.cpp
    src/nodes/ShowdownNode.cpp
    src/nodes/TerminalNode.cpp
    src/ranges/PrivateCards.cpp
    src/ranges/PrivateCardsManager.cpp
    src/ranges/RiverCombs.cpp
    src/ranges/RiverRangeManager.cpp
    src/compairer/Dic5Compairer.cpp
    src/solver/Solver.cpp
    src/solver/PCfrSolver.cpp
    src/solver/BestResponse.cpp
    src/trainable/Trainable.cpp
    src/trainable/CfrPlusTrainable.cpp
    src/trainable/DiscountedCfrTrainable.cpp
    src/trainable/DiscountedCfrTrainableHF.cpp
    src/trainable/DiscountedCfrTrainableSF.cpp
    src/tools/CommandLineTool.cpp
    src/tools/GameTreeBuildingSettings.cpp
    src/tools/PrivateRangeConverter.cpp
    src/tools/Rule.cpp
    src/tools/StreetSetting.cpp
    src/tools/lookup8.cpp
    src/tools/utils.cpp
    src/runtime/PokerSolver.cpp
    src/library.cpp
)

add_library(solver_core STATIC ${SOLVER_SOURCES})
target_include_directories(solver_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
if(OpenMP_CXX_FOUND)
    target_link_libraries(solver_core PUBLIC OpenMP::OpenMP_CXX)
endif()

# HTTP API server
add_executable(solver_api src/api_server.cpp)
target_link_libraries(solver_api solver_core)
if(OpenMP_CXX_FOUND)
    target_link_libraries(solver_api OpenMP::OpenMP_CXX)
endif()
