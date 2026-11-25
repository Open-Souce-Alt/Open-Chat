import Foundation

public struct AuthConnectResponse: Codable {
    public let accountId: String
}

public struct ApiErrorResponse: Codable {
    public let error: String?
}

public struct EventTypeEnvelope: Codable {
    public let type: String
}

public struct AuthChallengePayload: Codable {
    public let challengeType: String
    public let data: String
    public let prompt: String?
}

public struct AuthChallengeEvent: Codable {
    public let type: String
    public let platform: String
    public let accountLabel: String
    public let accountId: String
    public let challenge: AuthChallengePayload
}

public struct AuthStatusEvent: Codable {
    public let type: String
    public let platform: String
    public let accountLabel: String
    public let accountId: String
    public let status: String
    public let error: String?
}
