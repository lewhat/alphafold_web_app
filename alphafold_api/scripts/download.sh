#!/bin/bash
# Download the releveant DB... need 2.65TB
~/alphafold/scripts/download_alphafold_params.sh ~/alphafold_data > download.log 2> download_all.log &
~/alphafold/scripts/download_mgnify.sh ~/alphafold_data > download.log 2> download_all.log &
~/alphafold/scripts/download_pdb70.sh ~/alphafold_data > download.log 2> download_all.log &
~/alphafold/scripts/download_pdb_mmcif.sh ~/alphafold_data > download.log 2> download_all.log &
~/alphafold/scripts/download_pdb_seqres.sh ~/alphafold_data > download.log 2> download_all.log &
~/alphafold/scripts/download_small_bfd.sh ~/alphafold_data > download.log 2> download_all.log &
~/alphafold/scripts/download_uniprot.sh ~/alphafold_data > download.log 2> download_all.log &
~/alphafold/scripts/download_uniref30.sh ~/alphafold_data > download.log 2> download_all.log &
~/alphafold/scripts/download_uniref90.sh ~/alphafold_data > download.log 2> download_all.log &
~/alphafold/scripts/download_bfd.sh ~/alphafold_data > download.log 2> download_all.log &
