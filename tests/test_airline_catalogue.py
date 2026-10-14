import data_loader


def test_current_names_replace_reassigned_legacy_codes_and_keep_unknowns(monkeypatch):
    monkeypatch.setattr(data_loader, "_airlines_cache", None)
    names = data_loader.load_airlines()
    assert names["ITY"] == "ITA Airways"
    assert names["TKJ"] == "AJet"
    assert names["VJC"] == "Vietjet"
    assert names["JAT"] == "JetSMART Chile"
    assert names["LHX"] == "Lufthansa City Airlines"
    assert names["DLH"] == "Lufthansa"
    assert names["GEC"] == "Lufthansa Cargo"
    assert data_loader.get_airline_name("ZZZZ") == "ZZZZ"
    assert names["AFR"] == "Air France"
