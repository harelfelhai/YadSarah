using System.Globalization;
using System.Text;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

public record DiagnosisImportResult(bool Success, int Count, string Message);

/// <summary>
/// Refreshes the internal diagnosis catalog from an admin-uploaded official file
/// (CSV or .xlsx). Unlike the drug catalog there is no accessible live API for
/// Hebrew diagnoses, so file-import (or the seeded starter list) is the only source.
/// Applies a FULL snapshot via <see cref="DiagnosisCatalogService.ReplaceAllAsync"/>;
/// a failed import never throws into the app — it records status and leaves the last
/// good snapshot serving the closed picker.
/// </summary>
public class DiagnosisImportService(SettingsService settings, DiagnosisCatalogService catalog)
{
    // ── File import: the official CDC ICD-10-CM file (.txt code+description), or a
    //    CSV/.xlsx with code + name (English `code`/`description`, or Hebrew
    //    `קוד / שם_בעברית / שם_באנגלית`). ────────────────────────────────────────────
    public async Task<DiagnosisImportResult> ImportFromFileAsync(Stream stream, string fileName)
    {
        try
        {
            List<DiagnosisRecord> records;
            if (fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase))
            {
                records = BuildRecords(ReadXlsxRows(stream));
            }
            else
            {
                using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
                var content = await reader.ReadToEndAsync();
                // CDC ICD-10-CM "codes" file is whitespace-delimited (code + description),
                // not CSV — detect by extension.
                records = fileName.EndsWith(".txt", StringComparison.OrdinalIgnoreCase)
                    ? BuildRecords(ReadCdcTextRows(content))
                    : BuildRecords(ReadCsvRows(content));
            }

            if (records.Count == 0)
                return await RecordAsync(false, 0, "הקובץ ריק או לא בפורמט נתמך (ICD-10-CM .txt / CSV / XLSX עם עמודות קוד ותיאור).");

            var active = await catalog.ReplaceAllAsync(records);
            return await RecordAsync(true, active, $"יובאו {active} אבחנות מהקובץ.");
        }
        catch (Exception ex)
        {
            return await RecordAsync(false, 0, $"כשל בייבוא הקובץ: {ex.Message}");
        }
    }

    // Reads the first worksheet of an .xlsx into rows of trimmed cell strings.
    private static List<string[]> ReadXlsxRows(Stream stream)
    {
        using var ms = new MemoryStream();
        stream.CopyTo(ms);
        ms.Position = 0;
        using var wb = new ClosedXML.Excel.XLWorkbook(ms);
        var ws = wb.Worksheets.First();
        var rows = new List<string[]>();
        foreach (var row in ws.RowsUsed())
        {
            var lastCol = row.LastCellUsed()?.Address.ColumnNumber ?? 0;
            var cells = new string[lastCol];
            for (var c = 1; c <= lastCol; c++)
                cells[c - 1] = row.Cell(c).GetString();
            rows.Add(cells);
        }
        return rows;
    }

    private static List<string[]> ReadCsvRows(string content)
    {
        var rows = new List<string[]>();
        foreach (var line in content.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
            if (!string.IsNullOrWhiteSpace(line))
                rows.Add(SplitCsvLine(line).ToArray());
        return rows;
    }

    // Reads the CDC ICD-10-CM "codes" text file: each line is "<code><whitespace><english
    // description>" (no header). Yields [code, description] pairs for positional mapping.
    private static List<string[]> ReadCdcTextRows(string content)
    {
        var rows = new List<string[]>();
        foreach (var line in content.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var trimmed = line.TrimStart();
            var sep = trimmed.IndexOfAny(new[] { ' ', '\t' });
            if (sep <= 0) { rows.Add(new[] { trimmed }); continue; }
            var code = trimmed[..sep];
            var desc = trimmed[(sep + 1)..].Trim();
            rows.Add(new[] { code, desc });
        }
        return rows;
    }

    // ICD-10-CM codes are conventionally dotted after the 3rd character (e.g. the CDC
    // "codes" file lists them dotless: "J029" → "J02.9"). Normalize so uploaded files
    // match the dotted convention used everywhere else.
    private static string NormalizeCode(string code)
    {
        var c = code.Trim().ToUpperInvariant();
        if (c.Length > 3 && !c.Contains('.')) c = c.Insert(3, ".");
        return c;
    }

    // Header-aware row mapping. Recognizes English ICD-10-CM columns (code / description)
    // and Hebrew official-style columns (קוד / שם_בעברית / שם_באנגלית). English is the
    // primary name. Falls back to positional order [code, english description] (the CDC
    // .txt shape) when no known header is found; a Hebrew-only column needs an explicit
    // `שם_בעברית` header to land in the Hebrew field.
    private static List<DiagnosisRecord> BuildRecords(List<string[]> rows)
    {
        var records = new List<DiagnosisRecord>();
        if (rows.Count == 0) return records;

        int codeIdx = 0, enIdx = 1, hebIdx = -1, startRow = 0;
        var header = rows[0].Select(h => h.Trim().ToLowerInvariant()).ToList();

        bool MatchAny(string h, params string[] cands) => cands.Any(c => h.Contains(c));
        var hasHeader = header.Any(h =>
            MatchAny(h, "icd", "code", "קוד") ||
            MatchAny(h, "description", "english", "אנגלית", "עברית", "hebrew", "name"));
        if (hasHeader)
        {
            for (var i = 0; i < header.Count; i++)
            {
                var h = header[i];
                if (MatchAny(h, "icd", "code", "קוד")) codeIdx = i;
                else if (MatchAny(h, "hebrew", "עברית")) hebIdx = i;
                else if (MatchAny(h, "description", "english", "אנגלית", "name", "desc")) enIdx = i;
            }
            startRow = 1;
        }

        for (var r = startRow; r < rows.Count; r++)
        {
            var cols = rows[r];
            string Col(int i) => i >= 0 && i < cols.Length ? cols[i].Trim() : "";
            var code = Col(codeIdx);
            var en = Col(enIdx);
            var heb = Col(hebIdx);
            if (!string.IsNullOrWhiteSpace(code) && (!string.IsNullOrWhiteSpace(en) || !string.IsNullOrWhiteSpace(heb)))
                records.Add(new DiagnosisRecord(
                    NormalizeCode(code),
                    string.IsNullOrWhiteSpace(heb) ? null : heb,
                    string.IsNullOrWhiteSpace(en) ? null : en));
        }
        return records;
    }

    // Minimal RFC4180-style field splitter (quoted fields, escaped quotes, no embedded newlines).
    private static List<string> SplitCsvLine(string line)
    {
        var fields = new List<string>();
        var sb = new StringBuilder();
        var inQuotes = false;
        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (inQuotes)
            {
                if (c == '"')
                {
                    if (i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i++; }
                    else inQuotes = false;
                }
                else sb.Append(c);
            }
            else
            {
                if (c == '"') inQuotes = true;
                else if (c == ',') { fields.Add(sb.ToString()); sb.Clear(); }
                else sb.Append(c);
            }
        }
        fields.Add(sb.ToString());
        return fields;
    }

    // ── status persistence ──────────────────────────────────────────────────────
    private async Task<DiagnosisImportResult> RecordAsync(bool ok, int count, string message)
    {
        if (ok)
        {
            await settings.SetSystemAsync(SettingsService.DiagLastSyncAtKey, DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture));
            await settings.SetSystemAsync(SettingsService.DiagCountKey, count.ToString(CultureInfo.InvariantCulture));
        }
        await settings.SetSystemAsync(SettingsService.DiagLastSyncStatusKey, message);
        return new DiagnosisImportResult(ok, count, message);
    }
}
