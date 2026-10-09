---
sidebar_position: 5
---

# Import spreadsheets

**Auto Import** reads Excel workbooks (.xlsx) and CSV files. Use it for a report that a marketplace,
an e-wallet or a bank lets you download.

## Upload a spreadsheet

1. Click **Auto Import**.
2. In **Read as**, choose how Akaun reads the file. See [Which reading to choose](#which-reading-to-choose).
3. Drag the .xlsx or .csv file onto the drop area.

The queue shows the file as **Spreadsheet**. Akaun reads the cells directly. It does not use text
recognition.

## Which reading to choose

| **Read as** | Use it for | How Akaun reads it |
|---|---|---|
| **Single record** | A small sheet that is one bill. | The AI reads the text of the sheet. The text must have 6,000 characters or fewer. |
| **Multiple records** | A list of items that you import one time. | The AI reads all the text and makes one item from each line. |
| An import profile | A report that you import each month. | The profile tells Akaun how to read the report. |
| **Auto-detect** | Any file. | Akaun uses a profile that fits. If no profile fits, Akaun reads the file as a single record. |

With **Multiple records** and with an import profile, Akaun shows the items on one page. If the
reading finds only one item, Akaun shows one review card in its place. See
[Documents with many records](./documents-with-many-records.md).

## When you need an import profile

Make an import profile when one or more of these is true:

- You import the same report each week or each month.
- The report has many rows, and you want each row to become one record.
- You want Akaun to read the table without AI, so that the amounts come directly from the cells.
- Each type of row must go to its own category, for example commission or shipping fees.
- The report has a running balance, and you want Akaun to check that no row is missing.
- The report has withdrawals to your bank. These are transfers, not expenses.

A profile of the type **Table rows** reads the table without AI. If you choose it in **Read as**,
Akaun sends nothing to the AI provider. See
[Import profiles](./import-profiles.md).

## Transfers in a wallet report

A marketplace wallet or an e-wallet report often shows a withdrawal to your bank. The withdrawal
moves money between two of your own accounts. It is a transfer, not an expense.

To import withdrawals as transfers, use an import profile:

- Give the profile an **Account**, for example the wallet account.
- Add a section with the **Kind** **Transfer**.
- In the section, choose the **Other account**, for example your bank account.

The card of a transfer shows **Transfer from** and **Transfer to**. A transfer must be in the main
currency. If the same transfer is already in your records, the card shows a possible duplicate.
This can happen when you also import the bank statement. See
[Review and confirm](./review-and-confirm.md).

## Files that Akaun refuses

Akaun refuses some files when you upload them. The message shows below the drop area.

| File | Message | What to do |
|---|---|---|
| Old Excel file (.xls) | "This is an old Excel file (.xls), which cannot be read." | Open the file in Excel. Save it as .xlsx or .csv. Upload it again. |
| Binary Excel file (.xlsb) | "This is a binary Excel workbook (.xlsb), which cannot be read." | Save it as .xlsx or .csv. Upload it again. |
| Workbook with a password | "This workbook is protected with a password, so it cannot be read." | Remove the password in Excel. Save the file. Upload it again. |
| A .csv file that is a workbook | "The file is named .csv but is an Excel workbook." | Change the name to .xlsx, or save it from Excel as CSV. |
| An empty .csv file | "The CSV file is empty." | Download the report again. |

## Notes and limits

- A spreadsheet can have 200,000 rows or fewer, in all its sheets.
- An import profile reads one sheet of a workbook only. The built-in readings read all the sheets.
- A CSV file always has one sheet. So a profile that you made for a workbook also reads the same
  report as CSV.
- A single record from a spreadsheet longer than 6,000 characters fails. Read it again with
  **Multiple records** or with an import profile.

## Related

- [Import profiles](./import-profiles.md)
- [Documents with many records](./documents-with-many-records.md)
- [Move money between accounts](../03-everyday-tasks/move-money-between-accounts.md)
