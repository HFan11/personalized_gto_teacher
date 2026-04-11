FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    g++ cmake make libomp-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j$(nproc)

EXPOSE 8080
CMD ["./build/solver_api", "--port", "8080", "--resources", "./resources"]
