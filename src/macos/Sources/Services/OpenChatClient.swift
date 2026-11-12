import Foundation

public final class OpenChatClient: NSObject, URLSessionWebSocketDelegate {
    public let baseURL: URL
    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession!
    public var onEventReceived: ((String) -> Void)?

    public init(baseURL: URL = URL(string: "http://127.0.0.1:3000")!) {
        self.baseURL = baseURL
        super.init()
        self.urlSession = URLSession(configuration: .default, delegate: self, delegateQueue: OperationQueue())
    }

    public func fetchLs(path: String? = nil, all: Bool = true, sort: String = "time") async throws -> [VfsEntry] {
        var components = URLComponents(url: baseURL.appendingPathComponent("api/vfs/ls"), resolvingAgainstBaseURL: true)!
        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "all", value: all ? "true" : "false"),
            URLQueryItem(name: "sort", value: sort)
        ]
        if let path = path, !path.isEmpty {
            queryItems.append(URLQueryItem(name: "path", value: path))
        }
        components.queryItems = queryItems

        guard let requestURL = components.url else {
            throw URLError(.badURL)
        }

        let (data, response) = try await URLSession.shared.data(from: requestURL)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }

        let decoded = try JSONDecoder().decode(LsResponse.self, from: data)
        return decoded.entries
    }

    public func fetchCat(path: String, limit: Int = 50) async throws -> CatResult {
        var components = URLComponents(url: baseURL.appendingPathComponent("api/vfs/cat"), resolvingAgainstBaseURL: true)!
        components.queryItems = [
            URLQueryItem(name: "path", value: path),
            URLQueryItem(name: "limit", value: String(limit))
        ]

        guard let requestURL = components.url else {
            throw URLError(.badURL)
        }

        let (data, response) = try await URLSession.shared.data(from: requestURL)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }

        return try JSONDecoder().decode(CatResult.self, from: data)
    }

    public func connectWebSocket() {
        let wsScheme = baseURL.scheme == "https" ? "wss" : "ws"
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: true)!
        components.scheme = wsScheme
        components.path = "/ws"

        guard let wsURL = components.url else { return }

        webSocketTask = urlSession.webSocketTask(with: wsURL)
        webSocketTask?.resume()
        listenForMessages()
    }

    private func listenForMessages() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self?.onEventReceived?(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self?.onEventReceived?(text)
                    }
                @unknown default:
                    break
                }
                self?.listenForMessages()
            case .failure:
                // Auto-reconnect after 3 seconds
                DispatchQueue.global().asyncAfter(deadline: .now() + 3.0) { [weak self] in
                    self?.connectWebSocket()
                }
            }
        }
    }

    public func disconnectWebSocket() {
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
    }
}
