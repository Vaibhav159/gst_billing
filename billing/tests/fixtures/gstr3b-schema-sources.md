# GSTR-3B primary fixtures

Retrieved 12 October 2026 during the 3A implementation-plan replay.

- Full API request schema: GSTN `GSTR3B - Save GSTR3B data`, v7.1, published 23 March 2026 (GSTN lists its status as Draft): https://developer.gst.gov.in/pages/apiportal/data/Returns/GSTR3B%20-%20Save%20GSTR3B%20data/v7.1/GSTR3B%20-%20Save%20GSTR3B%20data%20request_schema.json
  - Raw SHA256: `043917ea6fcbe34e97e851fde6cfe9a472aaefb2be503e9438973b16e67480ae`.
  - Fixture: `gstr3b-gstn-v71-schema.json`, unchanged schema content with CRLF normalized to LF for the reproducible text patch. The raw-download hash above refers to the original GSTN bytes.
- GSTN public Excel utility: https://tutorial.gst.gov.in/offlineutilities/returns_gstr3b/GSTR3B_Excel_Utility.zip
  - Zip SHA256: `54e7a39b0d1db41cd726b93e14fce616695a2651cca633ed26124e8cc9211f03`.
  - Member `GSTR3B_Excel_Utility/GSTR3B_Excel_Utility_V5.8.xlsm` SHA256: `e7d2f3f5183d4275a4455b5385baffde47d87b364ccfff2b0cd9352b6051c3ce`.
  - The workbook was read as a zip and its VBA extracted for inspection, never executed. Its `removeInterSupValidation` suppresses `inter_sup` from November 2025. Its `eco_dtls` is emitted for July 2022 onward. Its Table 4 worksheet and emitter bind `itc_inelg[RUL]` to 4(D)(1), `itc_inelg[OTH]` to 4(D)(2), and `itc_rev[RUL]` to 4(B)(1).
  - `gstr3b-gstn-v58-keys.json` records only the emitted section keys and row type tags, not copied workbook code.
- Independent official confirmation of Table 3.2's November 2025 change: GST Council December 2025 newsletter, advisory dated 5 December 2025: https://gstcouncil.gov.in/sites/default/files/2026-01/monthly_newsletter_december_2025_1_0.pdf

The API schema allows optional `inter_sup`; the current public utility determines the tax-period cutoff. The API schema intentionally has no `ltfee_details`: the 3A file follows the contract and emits interest only.

Money rules: CBIC Circular 170/02/2022 at https://cbic-gst.gov.in/pdf/Circular-170-02-2022-GST.pdf; Rule 88A explanation in Circular 98/17/2019 at https://cbic-gst.gov.in/pdf/Circular-98-17-2019-GST.pdf; late-fee caps in Notifications 19/2021 and 20/2021 at https://cbic-gst.gov.in/pdf/central-tax/notfctn-19-central-tax-english-2021.pdf and https://cbic-gst.gov.in/pdf/central-tax/notfctn-20-central-tax-english-2021.pdf; 18% interest in Notification 13/2017 at https://gstcouncil.gov.in/sites/default/files/2024-04/notfctn-13-central-tax-english.pdf.
