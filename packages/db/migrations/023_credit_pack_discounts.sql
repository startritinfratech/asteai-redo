-- Bulk credit packs: list price is the base rate (1 credit = INR 5, as on /pricing, the
-- same rate as Pro's 100 credits for INR 499); bigger packs are discounted, up to 30%.
-- listPriceMinor is what the pack would cost at the base rate, so the UI can show the saving.
-- Prices in paise. The API refuses a pack discounted by more than 30%.

INSERT INTO platform_settings (key, value, updated_at) VALUES ('credit_packs', '[
  {"id":"starter","credits":50,"priceMinor":25000,"listPriceMinor":25000},
  {"id":"standard","credits":120,"priceMinor":54000,"listPriceMinor":60000},
  {"id":"growth","credits":300,"priceMinor":120000,"listPriceMinor":150000},
  {"id":"bulk","credits":1000,"priceMinor":350000,"listPriceMinor":500000}
]', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
