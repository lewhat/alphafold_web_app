import React, { useState } from "react";
import { isValidSequence } from "../../shared/utils";

interface SequenceInputProps {
  sequence: string;
  setSequence: (sequence: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

const SequenceInput: React.FC<SequenceInputProps> = ({
  sequence,
  setSequence,
  onSubmit,
  isLoading,
}) => {
  const [isValid, setIsValid] = useState<boolean>(true);
  const [validationMsg, setValidationMsg] = useState<string>("");

  const validateSequence = (seq: string): boolean => {
    if (!seq.trim()) {
      setIsValid(false);
      setValidationMsg("Please enter a protein sequence");
      return false;
    }

    if (!isValidSequence(seq)) {
      setIsValid(false);
      setValidationMsg(
        "Invalid amino acids: Use standard single-letter codes (ACDEFGHIKLMNPQRSTVWY).",
      );
      return false;
    }

    if (seq.length < 10) {
      setIsValid(false);
      setValidationMsg("Sequence is too short (minimum 10 amino acids)");
      return false;
    }

    if (seq.length > 1000) {
      setIsValid(false);
      setValidationMsg("Sequence is too long (maximum 1000 amino acids)");
      return false;
    }

    setIsValid(true);
    setValidationMsg("");
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateSequence(sequence)) {
      onSubmit();
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label
            htmlFor="sequence"
            className="block text-gray-700 font-medium mb-2"
          >
            Protein Sequence (Single Letter Amino Acid Codes)
          </label>
          <textarea
            id="sequence"
            rows={6}
            className={`w-full px-3 py-2 border rounded-md ${!isValid ? "border-red-500" : "border-gray-300"
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            placeholder="Enter protein sequence (e.g. MENFQKVEKIGEGTYGVVYKARNKLTGEVVALKKIRLDTETEGVPSTAIREIS)"
            value={sequence}
            onChange={(e) => {
              setSequence(e.target.value.replace(/\s/g, ""));
              if (!isValid) validateSequence(e.target.value);
            }}
            disabled={isLoading}
          />
          {!isValid && (
            <p className="text-red-500 text-sm mt-1">{validationMsg}</p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
            onClick={() => setSequence("")}
            disabled={isLoading}
          >
            Clear
          </button>

          <div className="flex space-x-4">
            <button
              type="button"
              className="px-4 py-2 bg-blue-100 text-blue-800 rounded-md hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onClick={() => {
                const example =
                  "MENFQKVEKIGEGTYGVVYKARNKLTGEVVALKKIRLDTETEGVPSTAIREIS";
                setSequence(example);
                validateSequence(example);
              }}
              disabled={isLoading}
            >
              Load Example
            </button>

            <button
              type="submit"
              className={`px-6 py-2 ${isLoading
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700"
                } text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500`}
              disabled={isLoading}
            >
              {isLoading ? "Processing..." : "Predict Structure"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default SequenceInput;
