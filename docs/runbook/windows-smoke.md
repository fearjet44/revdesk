# Windows smoke checklist

Nobody has run Revdesk on a real Windows machine yet. This page walks you from the download to an Issued PDF. Follow the steps in order, do one thing at a time, and compare what you see with the **Expected** line. If it differs, stop, write down what you saw in the report table at the end, and carry on with the next step if you can.

You do not need to know how Revdesk works. You do not need to be a developer.

## 1. Before you start

- Windows 10 or Windows 11.
- About 30 minutes.
- **Practice library only.** Use the practice sample that ships with the project (the `data` folder), copied somewhere you can write, for example `Documents\revdesk-practice`. To get it: open the project page on GitHub, choose **Code**, then **Download ZIP**, unzip it, and copy the `data` folder out. **Never open a company manual in this test.** If you are not sure a folder is the practice sample, do not use it.
- Write down where your practice copy came from (the ZIP, or a folder someone gave you). It matters for step 4.
- Install Node first. Revdesk cannot start without it, and the Prerequisites screen does not list it. Open PowerShell and run:

  ```powershell
  winget install OpenJS.NodeJS.LTS
  ```

  Then close PowerShell. This is the only tool to install before the first launch; the rest come in step 3.

## 2. Install

1. In the project on GitHub, open **Actions**, choose the **desktop** workflow, open the newest green run, scroll to **Artifacts**, and download `revdesk-x86_64-pc-windows-msvc`.
   - Expected: you have a ZIP file in Downloads.
2. Unzip it.
   - Expected: you see `Revdesk_<version>_x64-setup.exe`.
3. Double-click the `.exe`.
   - Expected: Windows shows a blue SmartScreen box saying it protected your PC. The installer is not signed yet, so this is normal.
4. Click **More info**, then **Run anyway**.
   - Expected: the installer runs without asking for an administrator password.
5. Finish the installer.
   - Expected: Revdesk is installed for your user only, under `%LOCALAPPDATA%\Revdesk`. Write down if it is anywhere else.
6. Open the Start menu and launch **Revdesk**.
   - Expected: a Revdesk window opens. **No black console window** appears behind it or in the taskbar.

## 3. Prerequisites

1. If a folder picker named **Open a Revdesk library** appears, choose your practice folder (the one that contains a folder called `manuals`).
   - Expected: the window title becomes `Revdesk — ` followed by the folder name, and the top right of the window reads `LOCAL LIBRARY · NO AUTH · FILE-BACKED`.
   - If a box titled **Not a Revdesk library** appears instead, you picked the wrong folder. Click **Choose Another**, and write down that it happened.
2. Look at the page that opens by itself. It should be titled **Prerequisites**, under the small heading **Desk setup**.
   - Expected: a table with the columns **Tool**, **Needed for**, **Found**, **Version**, and **Install**, and these rows: `chrome`, `qpdf`, `pdftotext`, `pdfinfo`, `pdffonts`, `git`. A bar across the top of the page says **Some tools Revdesk needs are missing.** with a link **See prerequisites** (unless everything is already installed).
   - If the page did not open by itself, click **Prerequisites** at the top of the window and write that down.
3. Write down every row that says **Not found** in the **Found** column. Put the list in the report.
   - Expected: each missing row shows an install line in the **Install** column with a **Copy** button. The `chrome` row covers Chrome or Edge; if neither is found its **Install** column says **Comes with this system**.
4. Open PowerShell and run these lines, one at a time. Skip any whose row was already found.

   ```powershell
   winget install Git.Git
   winget install QPDF.QPDF
   winget install oschwartz10612.Poppler
   ```

5. Close Revdesk completely, then open it again from the Start menu. (A running app does not see newly installed tools. If a row is still **Not found**, sign out of Windows and back in, then try again.)
6. Click **Prerequisites** at the top, then click **Check again**.
   - Expected: the button says **Checking…** for a moment. Every row now shows a path in **Found**. A green bar says **All tools found.** and the **Some tools Revdesk needs are missing.** bar is gone from every page.
   - If a row is still **Not found**, write down which, and any text in the **Install** column.
   - If only `qpdf` is missing, see the note in `desktop.md`: the qpdf installer may not add itself to the path.

### Bad override test

This checks the message when a setting points at a file that is not there. It uses PowerShell for setting and removing the setting only.

7. Close Revdesk. In PowerShell run:

   ```powershell
   setx REVDESK_QPDF "C:\nope\qpdf.exe"
   ```

   - Expected: PowerShell says `SUCCESS: Specified value was saved.`
8. Open Revdesk from the Start menu, click **Prerequisites**, and read the `qpdf` row.
   - Expected: **Found** says **Not found**, and the **Install** column says: `REVDESK_QPDF` points at `C:\nope\qpdf.exe`, which does not exist. Fix or unset it. The bar **Some tools Revdesk needs are missing.** is back.
   - This message comes from the T1.4 fix. If your build is older and the row shows a normal path instead, write that down; it only means your download predates the fix.
   - If nothing changed, sign out of Windows and back in (Windows may not have passed the new setting to the app), then check again.
9. Close Revdesk. Remove the setting. In PowerShell run:

   ```powershell
   [Environment]::SetEnvironmentVariable("REVDESK_QPDF", $null, "User")
   ```

10. Open Revdesk, click **Prerequisites**, then **Check again**.
    - Expected: **All tools found.** again.

## 4. Open the practice library

1. Look at the left column. Under the heading **Manuals**, find **GOML**.
   - Expected: a row reading `GOML`, `General Operations Manual`, and `GOML-R11`.
2. Click it.
   - Expected: a page with the small heading `GOML · faa-accepted`, the title **General Operations Manual**, and a list headed **SECTIONS**. Some rows say **Automatically managed** with a **View** button. The others have an **Open** button.
3. Find the row **Section 1 — Company Policy, Procedures, and Rules of Conduct**.
   - Expected: it has an **Open** button.
4. Click **Open** on **Section 1 — Company Policy, Procedures, and Rules of Conduct**.
   - Expected: an editing page with the small heading `WORKING COPY` followed by a change number, the title of the section, and the text below it: headings such as `1.1.0 Introduction` and `1.2.0 Distribution`, a numbered list of three items, and a small table (Alpha, Beta).
   - Look closely at the text. Expected: no stray symbols or odd characters at the ends of lines, no blank line between every pair of lines, and no doubled spacing.
   - This section opened a working copy. That is what **Open** does here.

The practice sample's files use Unix line endings. Windows line endings only show up if you edit a file with a Windows tool or got your copy from a Windows machine that converted it. Write down where your copy came from (step 1) so a bad result can be traced.

## 5. Make a change

You are now on the editing page for Section 1.

1. Click at the end of the first paragraph under the title (the one beginning `Excepteur sint occaecat`) and type: `This sentence was added in the smoke test.`
   - Expected: the sentence appears in the paragraph.
2. Click at the end of the last item of the numbered list under `1.2.0 Distribution` (the one beginning `In scelerisque`). Press **Enter**, then **Tab**, and type `Nested step.`
   - Expected: a new line appears indented under item 3 as a sub-step.
3. Click at the end of the paragraph under `1.1.0 Introduction`, press **Enter**, click **Bullets** in the toolbar, and type `First bullet.`
   - Expected: a bulleted line appears.
4. Look at the writing bar above the toolbar. In the box labelled **Mark**, open the list that starts **Why this write…** and choose `CL — Clarify; no policy change`.
   - Expected: the button **Write section** is no longer greyed out.
5. Click **Write section**.
   - Expected: the button says **Writing…**, then **Saved**.
6. Click **Back to packet**.
   - Expected: a page for your change with the label `CHANGE PACKET`, a lamp reading `DRAFT`, and under **TOUCHED SECTIONS** a row for the section with an **Edit** button. A bar says `Working copies live under control/working/` followed by the change number.
7. Click **Submit for review**.
   - Expected: the lamp changes to `REVIEW`. The button on the row now says **Review**, and a new button **Approve** appears.

Now the reviewer side.

8. On the row under **TOUCHED SECTIONS**, click **Review**.
   - Expected: a page with the small heading `REVIEW` and your change number, and the toggle at the top right with **Print** and **Review** (Review is highlighted).
   - Expected: lines you added are green and marked as incoming. Lines you changed or removed are red and marked as outgoing. The bar above the text shows the section id and two numbers, `<number> outgoing · <number> incoming`. Your three additions are among the green lines. The page also says: Incoming lines are green, outgoing lines are red.
   - If the bar says `no snapshot yet`, write that down.
9. Click **Print**, then **Review** again.
   - Expected: you move between the page as it will read and the line view without losing your text.
10. Click **Back to packet**, then click **Approve**.
    - Expected: the lamp changes to `APPROVED`. New buttons appear: **Open letter**, **Launch**, **Return to edit**. **Withdraw** is still there.

**Stop here. Do not click Launch.** This test does not issue anything.

## 6. Figure (skip until the Figure button ships, T3.2)

The editor toolbar does not have a Figure button yet. When the T3.2 task ships, the Figure button appears next to the other block buttons (**Note**, **Caution**, **Warning**, **Table**, **Diagram**). When it does, this step is:

1. Open a section from the **GOML** page, as in step 4. Click **Figure** in the toolbar.
   - Expected: a file picker opens that accepts PNG, JPEG, GIF, SVG, and WebP images up to 10 MB.
2. Pick a small PNG from your practice material (not a company image).
   - Expected: the picture appears as its own block, with a caption line below it and a size menu offering 25%, 50%, 75%, and 100%.
3. Type a caption, pick **50%**, choose a mark, and click **Write section**.
   - Expected: the button says **Saved** and the picture, caption, and size stay when you leave the page and come back.

Until then write **skipped** in the report.

## 7. Issued PDF in Edge

This uses the book that is already issued in the practice library, `GOML-R11`.

1. In the left column, under **Issued**, click the row with `GOML` and `GOML-R11`.
   - Expected: a page titled `GOML-R11` with the small heading `ISSUED`, a **PDF** button at the top right, a stamp reading `LAUNCHED`, and a **SECTIONS** list.
2. Click **PDF**.
   - Expected: a second Revdesk window opens. It says `Building the PDF…`, then shows the manual as a PDF. The bar at the top says: Reference only — this is not a controlled copy. Header stamp includes the download time.
   - If nothing opens, or it opens in another program, write that down.
   - If a red bar appears with a message instead, copy the message word for word into the report. A message about `qpdf`, `pdftotext`, or Chrome means a tool from step 3 is missing or not found.
3. Page through the PDF.
   - Expected: every page has a line at the top reading `Reference Only - This is not a controlled copy - Downloaded:` followed by today's date and a time in UTC.
4. Click **Download**.
   - Expected: nothing asks where to save. A file called `GOML-R11-reference.pdf` appears in your Downloads folder.
5. Open Downloads, and open `GOML-R11-reference.pdf` in Microsoft Edge (right-click, **Open with**, **Microsoft Edge**).
   - Expected: it opens with the same stamp line at the top of every page.
6. Figure: skip until the Figure button ships (T3.2). When it does, the picture you inserted in step 6 should print in the PDF at the size you chose, with its caption. Revdesk would need that change issued first, so for now write **skipped**.
7. Regulator copy: the desk has no button for it. Write **not reachable** in the report. (This copy has no stamp line by design.)
8. Back in the Revdesk PDF window, click **Back to issued**.
   - Expected: you return to the `GOML-R11` page.

## 8. Command line (optional, PowerShell)

The installed app does not include a command-line program. The installer ships only the window, the built pages, and the server file. The command line is **source checkout only**: it needs a copy of the project folder with Node installed, and you run `npm ci` once inside it.

From the project folder:

```powershell
node --experimental-strip-types cli\revdesk.ts doctor
echo $LASTEXITCODE
```

- Expected: the same list of tools as the Prerequisites screen, every line `ok`, and `0` printed by the second command. If a tool is missing it prints `missing` for that tool and the number is `5`.

Skip this step if you do not have a project folder. Write **skipped**.

## 9. Report back

Fill in the table. **pass** means what you saw matched **Expected**. **fail** means it did not. **skipped** means you did not do it. Screenshots are welcome. Take them of the practice library only, never of a company manual.

| Step | pass / fail / skipped | What you saw |
|---|---|---|
| 1. Before you start (Node installed; where your practice copy came from) | | |
| 2. Install: SmartScreen, installs under `%LOCALAPPDATA%\Revdesk` | | |
| 2. Install: no console window behind the app | | |
| 3. Prerequisites: which rows said **Not found** at first | | |
| 3. Prerequisites: all tools found after the install and **Check again** | | |
| 3. Bad override message (`REVDESK_QPDF`), then removed | | |
| 4. Open the practice library: **GOML** and its sections | | |
| 4. Text reads cleanly (no stray symbols, no doubled lines) | | |
| 5. Edit: sentence, nested step, bullet | | |
| 5. **Write section** shows **Saved** | | |
| 5. **Submit for review**, then **Review** shows the line diff | | |
| 5. **Approve** | | |
| 6. Figure | | |
| 7. **PDF** page opens and shows the manual | | |
| 7. **Download** saves `GOML-R11-reference.pdf` in Downloads | | |
| 7. Stamp line on every page, opened in Edge | | |
| 8. Command line `doctor` (optional) | | |

Send it to us: paste the table into a new GitHub issue titled `Windows smoke <date>` (for example `Windows smoke 2026-10-08`). Add your Windows version and the Revdesk version from the installer file name.
