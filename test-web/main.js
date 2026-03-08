import { convertMarkdownToDocx, downloadDocx } from '../dist/index.js';

document.addEventListener('DOMContentLoaded', () => {
    const convertBtn = document.getElementById('convert-btn');
    const markdownInput = document.getElementById('markdown-input');
    const imageAlignSelect = document.getElementById('image-align');
    const statusEl = document.getElementById('status');

    convertBtn.addEventListener('click', async () => {
        const markdown = markdownInput.value;
        const align = imageAlignSelect.value;
        
        statusEl.textContent = 'Generating DOCX...';
        convertBtn.disabled = true;

        try {
            const options = {
                documentType: "document",
                style: {
                    imageAlignment: align
                }
            };
            
            console.log("Converting with options:", options);
            const blob = await convertMarkdownToDocx(markdown, options);
            
            statusEl.textContent = 'Downloading...';
            downloadDocx(blob, "web_test_image.docx");
            
            statusEl.textContent = 'Done!';
        } catch (error) {
            console.error("Error converting:", error);
            statusEl.textContent = 'Error: ' + error.message;
        } finally {
            convertBtn.disabled = false;
        }
    });
});
