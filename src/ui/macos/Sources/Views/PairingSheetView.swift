import SwiftUI
import CoreImage.CIFilterBuiltins

public struct PairingSheetView: View {
    @ObservedObject var viewModel: AppViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var cleanSession: Bool = false
    @State private var otpCode: String = ""

    private let qrContext = CIContext()
    private let qrFilter = CIFilter.qrCodeGenerator()

    public var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label("Connect Platform Account", systemImage: "link.badge.plus")
                    .font(.title3.bold())
                Spacer()
                Button("Close") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)
            }

            Divider()

            Form {
                Picker("Platform", selection: $viewModel.pairingPlatform) {
                    Text("WhatsApp").tag("whatsapp")
                    Text("Instagram").tag("instagram")
                }
                .pickerStyle(.segmented)
                .disabled(viewModel.pairingStatus == "starting" || viewModel.pairingStatus == "awaiting_challenge")

                TextField("Account Label", text: $viewModel.pairingAccountLabel, prompt: Text("personal"))
                    .textFieldStyle(.roundedBorder)
                    .disabled(viewModel.pairingStatus == "starting" || viewModel.pairingStatus == "awaiting_challenge")

                Toggle("Clean session (re-pair from scratch)", isOn: $cleanSession)
                    .disabled(viewModel.pairingStatus == "starting" || viewModel.pairingStatus == "awaiting_challenge")
            }

            // Challenge / Status Area
            Group {
                if viewModel.pairingStatus == "starting" {
                    HStack(spacing: 12) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Connecting to \(viewModel.pairingPlatform.capitalized)...")
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 20)
                } else if viewModel.pairingStatus == "awaiting_challenge" {
                    if viewModel.pairingChallengeType == "qr_code", let qrData = viewModel.pairingChallengeData {
                        VStack(spacing: 12) {
                            if let qrImage = generateQRCode(from: qrData) {
                                Image(nsImage: qrImage)
                                    .interpolation(.none)
                                    .resizable()
                                    .scaledToFit()
                                    .frame(width: 210, height: 210)
                                    .padding(12)
                                    .background(Color.white)
                                    .cornerRadius(12)
                                    .shadow(radius: 2)
                            }
                            Text("Open WhatsApp → Settings → Linked Devices → Link a Device")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                    } else if viewModel.pairingChallengeType == "otp_input" {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(viewModel.pairingChallengePrompt ?? "Enter your 2FA verification code:")
                                .font(.subheadline)
                            HStack {
                                TextField("Verification Code", text: $otpCode)
                                    .textFieldStyle(.roundedBorder)
                                Button("Submit") {
                                    Task {
                                        await viewModel.submitChallengeResponse(otpCode)
                                    }
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(otpCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || viewModel.isSubmittingAuth)
                            }
                        }
                        .padding(.vertical, 8)
                    } else if let prompt = viewModel.pairingChallengePrompt {
                        Text(prompt)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .padding(.vertical, 8)
                    }
                } else if viewModel.pairingStatus == "authenticated" {
                    HStack(spacing: 10) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                            .font(.title2)
                        Text("Connected! Syncing chats...")
                            .font(.headline)
                            .foregroundColor(.green)
                    }
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 20)
                }
            }

            if let err = viewModel.pairingError {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.red)
                    Text(err)
                        .font(.caption)
                        .foregroundColor(.red)
                        .textSelection(.enabled)
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.red.opacity(0.1))
                .cornerRadius(8)
            }

            Divider()

            HStack {
                Spacer()
                if viewModel.pairingStatus == "idle" || viewModel.pairingStatus == "failed" {
                    Button("Connect") {
                        Task {
                            await viewModel.startPairing(clean: cleanSession)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(viewModel.isSubmittingAuth)
                }
            }
        }
        .padding(20)
        .frame(width: 420)
    }

    private func generateQRCode(from string: String) -> NSImage? {
        qrFilter.message = Data(string.utf8)
        qrFilter.correctionLevel = "M"

        guard let outputImage = qrFilter.outputImage else { return nil }
        let scaled = outputImage.transformed(by: CGAffineTransform(scaleX: 8, y: 8))

        guard let cgImage = qrContext.createCGImage(scaled, from: scaled.extent) else { return nil }
        return NSImage(cgImage: cgImage, size: NSSize(width: cgImage.width, height: cgImage.height))
    }
}
