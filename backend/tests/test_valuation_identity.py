"""A statement of another person must never land in a client's valuation."""
from app.backoffice.valuation.reconciliation import check_client_identity, name_matches


def test_name_matching_tolerates_spelling_slips_and_titles():
    assert name_matches("Shivanand Narsing Gulvady", "Client Name Shivnand Narsing Gulvady Holding Date")
    assert name_matches("Mr. Aditya Parchure", "ADITYA  PARCHURE")
    assert not name_matches("Aditya Parchure", "Shivnand Narsing Gulvady")


def test_no_file_naming_client_is_an_error_one_odd_file_a_warning():
    err = check_client_identity("Aditya Parchure", [("f1", "a.pdf", "Shivnand Narsing Gulvady")])
    assert err[0].severity == "error" and err[0].status == "failed"
    mix = check_client_identity("Aditya Parchure", [("f1", "a.pdf", "Aditya Parchure"), ("f2", "b.pdf", "Someone Else")])
    assert [(c.severity, c.subject) for c in mix] == [("warning", "f2")]
    assert check_client_identity("Aditya Parchure", [("f1", "a.pdf", "aditya parchure")])[0].status == "passed"
    assert check_client_identity("Aditya Parchure", [("f1", "x.xlsx", None)]) == []       # unreadable text: nothing to compare
    assert check_client_identity("", [("f1", "a.pdf", "x y")]) == []                       # unresolved CRM name: skipped, not guessed
