// Reads text out of an image or PDF using what macOS already has (Vision and PDFKit).
// Build once with: npm run setup:ocr
// Use: bin/ocr <file>   -> prints the text
import AppKit
import Foundation
import PDFKit
import Vision

let maxPages = 8

func recognize(_ image: CGImage) -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do { try handler.perform([request]) } catch { return "" }
    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    return lines.joined(separator: "\n")
}

func cgImage(_ image: NSImage) -> CGImage? {
    var rect = CGRect(origin: .zero, size: image.size)
    return image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write("usage: ocr <file>\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
var output: [String] = []

if url.pathExtension.lowercased() == "pdf" {
    guard let pdf = PDFDocument(url: url) else { exit(1) }
    for index in 0..<min(pdf.pageCount, maxPages) {
        guard let page = pdf.page(at: index) else { continue }
        let embedded = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if embedded.count > 20 {
            output.append(embedded)
        } else {
            // Scanned page: render it and read the picture.
            let bounds = page.bounds(for: .mediaBox)
            let scale: CGFloat = 2
            let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
            if let image = cgImage(page.thumbnail(of: size, for: .mediaBox)) {
                output.append(recognize(image))
            }
        }
    }
} else {
    guard let image = NSImage(contentsOf: url), let cg = cgImage(image) else { exit(1) }
    output.append(recognize(cg))
}

print(output.joined(separator: "\n\n"))
